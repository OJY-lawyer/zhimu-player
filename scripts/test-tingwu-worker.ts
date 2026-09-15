import assert from 'node:assert/strict'
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import Module from 'node:module'
import https from 'node:https'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { inspectTingwuMedia } from '../src/main/tingwuClient'

async function main(): Promise<void> {
  await fs.mkdir(path.resolve('work'), { recursive: true })
  const directory = await fs.mkdtemp(path.resolve('work', 'tingwu-worker-test-'))
  const historyPath = path.join(directory, 'tingwu-tasks.json')
  const mediaPath = path.join(directory, 'sample.mp4')
  const outputPath = path.join(directory, 'sample.srt')
  await fs.writeFile(mediaPath, 'offline media fixture')
  const media = await inspectTingwuMedia(mediaPath)
  let expectedTaskKey = media.key
  const handlers = new Map<string, (...args: any[]) => any>()
  const events: unknown[] = []
  const appEvents = new Map<string, () => void>()
  const mainFrame = {}
  const contents = { mainFrame, isDestroyed: () => false, send: (_channel: string, value: unknown) => events.push(value) }
  const player = { isDestroyed: () => false, webContents: contents }
  const event = { sender: contents, senderFrame: mainFrame }
  const calls: string[] = []
  let authenticated = true
  let holdPoll = false
  let enteredPoll: (() => void) | undefined
  let uploads = 0
  const mockSession = {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {},
    webRequest: { onBeforeRequest() {} },
    clearStorageData: async () => {}, clearCache: async () => {}, cookies: { flushStore: async () => {} },
    fetch: async (url: string, options: RequestInit) => {
      calls.push(url)
      const action = options.body ? JSON.parse(String(options.body)).action : 'auth'
      if (!authenticated) return { ok: false, status: 401, json: async () => ({}) }
      if (action === 'getTransList' && holdPoll) {
        enteredPoll?.()
        await new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
      }
      let data: unknown
      if (action === 'auth') data = { id: 'offline-user' }
      else if (action === 'generatePutLink') {
        const history = JSON.parse(readFileSync(historyPath, 'utf8'))
        assert.equal(history[expectedTaskKey].stage, 'creating', 'task intent saved before remote creation')
        data = { transId: 'offline-task', putLink: 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/media.mp4',
          sts: { endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'test-bucket', fileKey: 'media.mp4',
            accessKeyId: 'fixture-id', accessKeySecret: 'fixture-secret', securityToken: 'fixture-token' } }
      } else if (action === 'syncPutLink') {
        assert.equal(JSON.parse(readFileSync(historyPath, 'utf8'))[expectedTaskKey].stage, 'syncing')
        data = {}
      } else if (action === 'getTransList') data = [{ transId: 'offline-task', status: 3 }]
      else if (action === 'getTransResult') data = { duration: 2, wordCount: 4,
        result: { pg: [{ sc: [{ bt: 10, et: 1600, tc: '离线字幕。' }] }] } }
      else throw new Error(`unexpected action: ${action}`)
      return { ok: true, status: 200, json: async () => ({ code: '0', data }) }
    },
  }
  const moduleLoader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
  const originalLoad = moduleLoader._load
  const originalRequest = https.request
  moduleLoader._load = function (name: string, ...args: unknown[]) {
    if (name === 'electron') return {
      app: { getPath: () => directory, on: (name: string, callback: () => void) => appEvents.set(name, callback) },
      ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
      session: { fromPartition: (partition: string) => { assert.equal(partition, 'persist:tingwu-player'); return mockSession } },
    }
    return originalLoad.call(this, name, ...args)
  }
  https.request = ((url: URL, options: { headers: Record<string, string> }, callback: (response: Readable) => void) => {
    assert.equal(url.hostname, 'test-bucket.oss-cn-hangzhou.aliyuncs.com')
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(JSON.parse(readFileSync(historyPath, 'utf8'))[expectedTaskKey].stage, 'uploading')
    uploads++
    return new Writable({
      write(_chunk, _encoding, done) { done() },
      final(done) {
        const response = Readable.from(['mock OK']) as Readable & { statusCode: number }
        response.statusCode = 200
        callback(response)
        done()
      },
    })
  }) as unknown as typeof https.request

  try {
    // Bundle this test with electron external; the module loader supplies the fake
    // Electron host. All API calls and binary uploads remain entirely offline.
    const { registerAsrWorker } = await import('../src/main/asrWorker')
    registerAsrWorker(() => player as any)
    const call = (name: string, ...args: unknown[]) => handlers.get(name)!(event, ...args)
    await assert.rejects(() => handlers.get('asr-start')!({ ...event, senderFrame: {} }, [mediaPath]), /不允许/)
    assert.equal((await call('asr-start', [path.join(directory, 'unsupported.ts')])).success, false)
    assert.equal(calls.length, 0, 'batch is validated before API access')

    authenticated = false
    assert.equal((await call('asr-start', [mediaPath])).success, false)
    assert.equal(uploads, 0)
    authenticated = true
    assert.equal((await call('asr-start', [mediaPath])).success, true)
    assert.equal(uploads, 1)
    assert.match(await fs.readFile(outputPath, 'utf8'), /离线字幕/)
    const historyText = await fs.readFile(historyPath, 'utf8')
    assert.equal(JSON.parse(historyText)[media.key].stage, 'completed')
    assert.ok(!/fixture-token|fixture-secret|aliyuncs|sample\.mp4/.test(historyText), 'history contains no credentials or media path')
    const beforeExisting = calls.length
    await fs.writeFile(outputPath, '用户修正字幕')
    assert.equal((await call('asr-start', [mediaPath])).success, false, 'malformed existing SRT must not be reported as ready')
    assert.equal(calls.length, beforeExisting)
    assert.equal(await fs.readFile(outputPath, 'utf8'), '用户修正字幕')
    const correctedSrt = '1\n00:00:00,000 --> 00:00:02,000\n用户修正字幕\n'
    await fs.writeFile(outputPath, correctedSrt)
    assert.equal((await call('asr-start', [mediaPath])).success, true)
    assert.equal(calls.length, beforeExisting, 'existing subtitle skips authentication and upload')
    assert.equal(await fs.readFile(outputPath, 'utf8'), correctedSrt)

    await fs.unlink(outputPath)
    assert.equal((await call('asr-start', [mediaPath])).success, true)
    assert.equal(uploads, 1, 'missing output is recovered from persisted cloud task')
    await fs.unlink(outputPath)
    const pollEntered = new Promise<void>(resolve => { enteredPoll = resolve })
    holdPoll = true
    const running = call('asr-start', [mediaPath])
    await pollEntered
    assert.equal((await call('asr-start', [mediaPath])).success, false)
    assert.equal((await call('asr-logout')).success, false)
    assert.equal(await call('asr-cancel'), true)
    const cancelled = await running
    assert.equal(cancelled.cancelled, true)
    assert.equal(uploads, 1)
    holdPoll = false
    assert.equal((await call('asr-start', [mediaPath])).success, true)
    assert.equal(uploads, 1, 'cancelled cloud polling resumes without upload')

    await fs.unlink(outputPath)
    await fs.writeFile(historyPath, JSON.stringify({ [media.key]: {
      localTaskId: 'local-uncertain', stage: 'creating', updatedAt: new Date().toISOString(),
    } }))
    const uncertain = await call('asr-start', [mediaPath])
    assert.equal(uncertain.success, false)
    assert.match(uncertain.message, /停止重复提交/)
    assert.equal(uploads, 1, 'uncertain creation never silently repeats upload')
    expectedTaskKey = createHash('sha256').update(media.key + ':en').digest('hex')
    assert.equal((await call('asr-start', [mediaPath], 'en')).success, true)
    assert.equal(uploads, 2, 'English speech uses a separate cloud task instead of resuming a Chinese task')
    const languagesHistory = JSON.parse(await fs.readFile(historyPath, 'utf8'))
    assert.equal(Object.keys(languagesHistory).length, 2)
    assert.equal(languagesHistory[media.key].stage, 'creating', 'the original Chinese history is preserved')
    const beforeInvalidLanguage = calls.length
    assert.equal((await call('asr-start', [mediaPath], 'invalid')).success, false)
    assert.equal(calls.length, beforeInvalidLanguage)
    assert.ok(appEvents.has('before-quit'))
    assert.ok(events.length > 0)
    console.log('tingwu-worker: offline full upload, persistent resume, preserve edits, cancellation, concurrency and IPC isolation passed')
  } finally {
    https.request = originalRequest
    moduleLoader._load = originalLoad
    await fs.rm(directory, { recursive: true, force: true })
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
