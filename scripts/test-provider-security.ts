import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
// Resolve the installed build tool at runtime instead of bundling its native host.
const { transformSync } = hostRequire('esbuild') as typeof import('esbuild')
const workRoot = path.resolve(root, 'work')
const failures: string[] = []

function makeHost(directory: string, options: {
  preparationFailure?: 'mkdtemp' | 'writeFile'
  immediateTimers?: boolean
} = {}) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const appHandlers = new Map<string, () => void>()
  const timers = new Map<number, { callback: () => void; ms: number }>()
  const removed: string[] = []
  const cryptoKey = randomBytes(32)
  let encrypted = 0
  let decrypted = 0
  let encryptionAvailable = true
  let nextTimer = 1
  let fetcher: (...args: any[]) => Promise<any> = async () => { throw new Error('unexpected network attempt') }
  const safeStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (text: string) => {
      encrypted++
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', cryptoKey, iv)
      const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      // An opaque reversible stand-in; Windows DPAPI is not exercised here.
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    decryptString: (value: Buffer) => {
      decrypted++
      const decipher = createDecipheriv('aes-256-gcm', cryptoKey, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
  const mockedPromises = {
    ...fs.promises,
    mkdtemp: async (prefix: string) => {
      if (options.preparationFailure === 'mkdtemp') throw Object.assign(new Error('fixture mkdir denied'), { code: 'EACCES' })
      return fs.promises.mkdtemp(prefix)
    },
    writeFile: async (...args: Parameters<typeof fs.promises.writeFile>) => {
      if (options.preparationFailure === 'writeFile') throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' })
      return fs.promises.writeFile(...args)
    },
    rm: async (target: string, rmOptions: Parameters<typeof fs.promises.rm>[1]) => {
      assert.equal(path.dirname(target), directory, 'temporary cleanup remains in the test-owned directory')
      removed.push(target)
      return fs.promises.rm(target, rmOptions)
    },
  }
  const electron = {
    app: { getPath: () => directory, on: (name: string, callback: () => void) => appHandlers.set(name, callback) },
    safeStorage,
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    clipboard: { readText: () => '', clear() {} },
  }
  const context = vm.createContext({
    console, Buffer, URL, AbortController, DOMException, process,
    fetch: (...args: any[]) => fetcher(...args),
    setTimeout: (callback: () => void, ms: number) => {
      const id = nextTimer++
      timers.set(id, { callback, ms })
      if (options.immediateTimers) queueMicrotask(() => { if (timers.delete(id)) callback() })
      return id
    },
    clearTimeout: (id: number) => { timers.delete(id) },
  })
  const cache = new Map<string, { exports: any }>()
  const load = (relative: string): any => {
    const file = path.resolve(root, relative)
    const existing = cache.get(file)
    if (existing) return existing.exports
    const module = { exports: {} as any }
    cache.set(file, module)
    let source = fs.readFileSync(file, 'utf8')
    if (file.endsWith('chatgptEdgeWorker.ts')) source += '\nexport { waitForGuideAnswer as __testWaitForGuideAnswer };\n'
    const compiled = transformSync(source, { loader: 'ts', format: 'cjs', target: 'node22', sourcefile: file }).code
    const localRequire = (name: string): any => {
      if (name === 'electron') return electron
      if (name === 'node:fs' || name === 'fs') return { ...fs, promises: mockedPromises }
      if (name === 'node:child_process') return { spawn: () => { throw new Error('real browser launch is forbidden in offline tests') } }
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.ts')))
      return hostRequire(name)
    }
    const execute = vm.runInContext(`(function(require,module,exports,__filename,__dirname){${compiled}\n})`, context, { filename: file })
    execute(localRequire, module, module.exports, file, path.dirname(file))
    return module.exports
  }
  return {
    load, handlers, appHandlers, timers, removed,
    get encrypted() { return encrypted }, get decrypted() { return decrypted },
    setEncryptionAvailable(value: boolean) { encryptionAvailable = value },
    setFetch(value: typeof fetcher) { fetcher = value },
  }
}

async function runCase(name: string, callback: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.promises.mkdtemp(path.join(workRoot, 'provider-security-'))
  let watchdog: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([callback(directory), new Promise<never>((_resolve, reject) => {
      watchdog = setTimeout(() => reject(new Error('offline fixture did not settle within 5 seconds')), 5_000)
    })])
    console.log(`provider-security: ${name}: passed`)
  }
  catch (error) {
    failures.push(name)
    console.error(`provider-security: ${name}: FAILED`, error instanceof Error ? error.message : error)
  } finally {
    clearTimeout(watchdog)
    assert.equal(path.dirname(directory), workRoot)
    assert.ok(path.basename(directory).startsWith('provider-security-'))
    await fs.promises.rm(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  await fs.promises.mkdir(workRoot, { recursive: true })
  await runCase('encrypt plaintext migration and omit all secrets from renderer result', async directory => {
    const host = makeHost(directory)
    const config = host.load('src/main/configStore.ts')
    const file = path.join(directory, 'config.json')
    fs.writeFileSync(file, JSON.stringify({ provider: 'compatible-api', baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash', apiKey: 'fixture-legacy-key' }))
    const visible = config.loadConfig()
    assert.equal(visible.apiKey, '')
    assert.equal(visible.hasApiKey, true)
    assert.equal(visible.apiKeyEncrypted, undefined)
    assert.ok(!JSON.stringify(visible).includes('fixture-legacy-key'))
    const disk = fs.readFileSync(file, 'utf8')
    assert.ok(!disk.includes('fixture-legacy-key'))
    assert.equal(JSON.parse(disk).apiKey, undefined)
    assert.equal(typeof JSON.parse(disk).apiKeyEncrypted, 'string')
    assert.equal(host.encrypted, 1)
    assert.equal(config.loadConfig(true).apiKey, 'fixture-legacy-key')
    assert.equal(host.encrypted, 1, 'migration occurs once')
    config.saveConfig({ ...visible, baseUrl: 'https://api.deepseek.com/v1', apiKey: '' })
    assert.equal(config.loadConfig(true).apiKey, 'fixture-legacy-key', 'same origin retains explicitly saved key')
    config.saveConfig({ ...visible, clearApiKey: true, apiKey: '' })
    assert.equal(config.loadConfig(true).apiKey, '')
    host.setEncryptionAvailable(false)
    assert.throws(() => config.saveConfig({ ...visible, apiKey: 'fixture-never-persisted' }), /加密/)
    assert.ok(!fs.readFileSync(file, 'utf8').includes('fixture-never-persisted'))
  })

  await runCase('changing API origin never transfers the old provider key', async directory => {
    const host = makeHost(directory)
    const config = host.load('src/main/configStore.ts')
    const original = { provider: 'compatible-api', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', apiKey: 'fixture-source-key' }
    config.saveConfig(original)
    const visible = config.loadConfig()
    let rejected = false
    try { config.saveConfig({ ...visible, baseUrl: 'https://other-provider.example/v1', apiKey: '' }) }
    catch { rejected = true }
    const after = config.loadConfig(true)
    if (rejected) assert.equal(new URL(after.baseUrl).origin, 'https://api.deepseek.com', 'failed provider switch leaves the old destination intact')
    else assert.equal(after.apiKey, '', 'a new API origin must not inherit the old key')
    config.saveConfig({ ...visible, baseUrl: 'https://other-provider.example/v1', apiKey: 'fixture-new-key' })
    assert.equal(config.loadConfig(true).apiKey, 'fixture-new-key')
    assert.ok(!JSON.stringify(config.loadConfig()).includes('fixture-new-key'))
  })

  await runCase('saving ChatGPT and DeepSeek source round trips retains both accounts and settings', async directory => {
    const host = makeHost(directory)
    const config = host.load('src/main/configStore.ts')
    const original = { provider: 'chatgpt-web', baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      model: 'fixture-custom-model', apiKey: 'fixture-api-key', chatGptTier: 'pro',
      chatGptProject: 'Fixture project', setupCompleted: true, guideLanguage: 'source', asrLanguage: 'en' }
    const markers = [path.join(directory, 'chatgpt-edge-profile', 'Default', 'Network', 'Cookies'),
      path.join(directory, 'Partitions', 'tingwu-player', 'Network', 'Cookies')]
    const markerBytes = Buffer.from('synthetic login material; never a real account')
    for (const marker of markers) { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, markerBytes) }
    config.saveConfig(original)
    // Each step reloads the redacted renderer configuration from disk, exactly
    // as closing/reopening Settings does. A blank key means retain, not delete.
    for (const provider of ['compatible-api', 'chatgpt-web', 'compatible-api', 'chatgpt-web']) {
      const draft = config.loadConfig()
      assert.equal(draft.apiKey, '')
      assert.equal(draft.hasApiKey, true)
      config.saveConfig({ ...draft, provider })
      const saved = config.loadConfig(true)
      assert.equal(saved.provider, provider)
      for (const field of ['baseUrl', 'model', 'chatGptTier', 'chatGptProject', 'guideLanguage', 'asrLanguage'] as const) {
        assert.equal(saved[field], original[field], `${field} survives source switch`)
      }
      assert.equal(saved.apiKey, original.apiKey)
      assert.equal(config.resolveDraftApiKey({ baseUrl: saved.baseUrl, apiKey: '' }), original.apiKey)
      assert.ok(!fs.readFileSync(path.join(directory, 'config.json'), 'utf8').includes(original.apiKey))
      for (const marker of markers) assert.deepEqual(fs.readFileSync(marker), markerBytes, 'switching does not remove or alter login material')
    }
    assert.deepEqual(host.removed, [], 'source selection must not clean browser profiles')
  })

  await runCase('API endpoint normalization preserves the root and existing completion paths', async directory => {
    const host = makeHost(directory)
    const { normalizeApiEndpoint } = host.load('src/main/apiGuide.ts')
    assert.equal(normalizeApiEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions')
    assert.equal(normalizeApiEndpoint('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions')
    assert.equal(normalizeApiEndpoint('https://api.deepseek.com/v1/chat/completions'), 'https://api.deepseek.com/v1/chat/completions')
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com?token=fixture', 'https://example.com/#fragment']) {
      assert.throws(() => normalizeApiEndpoint(url))
    }
    assert.equal(normalizeApiEndpoint('http://127.0.0.1:9000/v1/'), 'http://127.0.0.1:9000/v1/chat/completions')
  })

  await runCase('API completion requires stop and never follows authenticated redirects', async directory => {
    const host = makeHost(directory)
    const { requestCompletion } = host.load('src/main/apiGuide.ts')
    const config = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash', apiKey: 'fixture-api-key' }
    const signal = new AbortController().signal
    const responses = (finish: unknown, content = 'final guide') => async (url: string, options: RequestInit) => {
      assert.equal(url, 'https://api.deepseek.com/v1/chat/completions')
      assert.equal(options.redirect, 'error')
      assert.equal(options.signal, signal)
      assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer fixture-api-key')
      const payload = JSON.parse(String(options.body))
      assert.equal(payload.model, config.model)
      return { ok: true, status: 200, json: async () => ({ choices: [{ finish_reason: finish, message: { content } }] }) }
    }
    assert.equal(await requestCompletion(config, [{ role: 'user', content: 'fixture' }], signal, responses('stop')), 'final guide')
    for (const finish of ['length', 'tool_calls', null, undefined]) {
      await assert.rejects(() => requestCompletion(config, [], signal, responses(finish)), /完整结束|长度限制/)
    }
    await assert.rejects(() => requestCompletion(config, [], signal, responses('stop', ' ')), /正文/)
    await assert.rejects(() => requestCompletion(config, [], signal, async () => ({ ok: false, status: 401,
      json: async () => { throw new Error('sensitive provider body must not be read') } })), /API Key/)
  })

  for (const mode of ['cancel', 'timeout', 'quit'] as const) {
    await runCase(`API ${mode} interrupts response body and releases the busy state`, async directory => {
      const host = makeHost(directory)
      host.load('src/main/configStore.ts').saveConfig({ provider: 'compatible-api', baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-flash', apiKey: 'fixture-key' })
      const api = host.load('src/main/apiGuide.ts')
      api.registerApiGuide()
      let bodyStarted!: () => void
      const started = new Promise<void>(resolve => { bodyStarted = resolve })
      host.setFetch(async (_url: string, options: RequestInit) => ({ ok: true, status: 200,
        json: () => new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new DOMException('aborted body', 'AbortError')), { once: true })
          bodyStarted()
        }),
      }))
      const invoke = host.handlers.get('api-guide')!
      const resultPromise = invoke({}, [{ role: 'user', content: 'fixture' }])
      await started
      assert.equal((await invoke({}, [{ role: 'user', content: 'duplicate' }])).success, false)
      if (mode === 'cancel') assert.equal(host.handlers.get('api-cancel')!(), true)
      else if (mode === 'quit') host.appHandlers.get('before-quit')!()
      else {
        const timeout = [...host.timers.values()].find(timer => timer.ms >= 60_000)
        assert.ok(timeout, 'deadline remains armed while the response body is pending')
        timeout.callback()
      }
      const result = await resultPromise
      assert.equal(result.success, false)
      assert.equal(result.cancelled, mode !== 'timeout')
      assert.equal(result.content, undefined)
      if (mode === 'timeout') assert.match(result.message, /超时/)
      assert.equal(host.timers.size, 0)
      host.setFetch(async () => ({ ok: true, status: 200, json: async () => ({ choices: [
        { finish_reason: 'stop', message: { content: 'recovered guide' } },
      ] }) }))
      assert.equal((await invoke({}, [{ role: 'user', content: 'retry' }])).success, true)
    })
  }

  await runCase('ChatGPT actual recovery script requires finished status and end_turn on the active branch', async directory => {
    const host = makeHost(directory, { immediateTimers: true })
    const { __testWaitForGuideAnswer } = host.load('src/main/chatgptEdgeWorker.ts')
    const samples: { status?: string; end_turn: boolean; channel: string; text: string; hidden?: boolean }[] = [
      { status: 'in_progress', end_turn: true, channel: 'final', text: 'unfinished status' },
      { status: 'finished_successfully', end_turn: false, channel: 'final', text: 'unfinished turn' },
      { status: undefined, end_turn: true, channel: 'final', text: 'missing status' },
      { status: 'finished_successfully', end_turn: true, channel: 'analysis', text: 'analysis is not the guide' },
      { status: 'finished_successfully', end_turn: true, channel: 'final', text: 'hidden output is not the guide', hidden: true },
      { status: 'finished_successfully', end_turn: true, channel: 'final', text: 'complete guide' },
    ]
    let reads = 0
    let evaluations = 0
    const cdp = { send: async (method: string, parameters: { expression: string }) => {
      assert.ok(++evaluations <= 20, 'completion polling exceeded the bounded fixture sequence')
      assert.equal(method, 'Runtime.evaluate')
      const page = vm.createContext({
        fetch: async (url: string) => {
          if (url.includes('/api/auth/session')) return { ok: true, json: async () => ({ accessToken: 'fixture-session-token' }) }
          assert.ok(url.includes('/backend-api/conversation/'))
          assert.ok(reads < samples.length, 'should finish exactly when both completion fields are confirmed')
          const sample = samples[reads++]
          return { ok: true, json: async () => ({ current_node: 'current', mapping: {
            current: { id: 'current', parent: null, message: { author: { role: 'assistant' }, status: sample.status,
              end_turn: sample.end_turn, channel: sample.channel, metadata: { is_visually_hidden_from_conversation: sample.hidden },
              create_time: reads, content: { parts: [sample.text] } } },
            abandoned: { id: 'abandoned', parent: null, message: { author: { role: 'assistant' },
              status: 'finished_successfully', end_turn: true, channel: 'final', create_time: 999,
              content: { parts: ['wrong branch must never be returned'] } } },
          } }) }
        },
      })
      const value = await vm.runInContext(parameters.expression, page)
      assert.ok(!JSON.stringify(value).includes('fixture-session-token'), 'session token must remain inside the browser context')
      return { result: { value } }
    } }
    assert.equal(await __testWaitForGuideAnswer(cdp, 'fixture-session', 'fixture-conversation', null), 'complete guide')
    assert.equal(reads, samples.length)
  })

  for (const preparationFailure of ['mkdtemp', 'writeFile'] as const) {
    await runCase(`ChatGPT ${preparationFailure} failure resets busy state and cleans created task directory`, async directory => {
      const host = makeHost(directory, { preparationFailure })
      host.load('src/main/chatgptEdgeWorker.ts').registerChatGptEdgeWorker(() => null)
      const result = await host.handlers.get('chatgpt-generate-guide')!({}, { taskMarkdown: 'fixture subtitles', playlistName: 'fixture' })
      assert.equal(result.success, false)
      assert.equal(await host.handlers.get('chatgpt-cancel-guide')!(), false, 'preparation failure must release generationBusy')
      if (preparationFailure === 'writeFile') assert.equal(host.removed.length, 1, 'failed write removes its allocated task directory')
      assert.deepEqual(fs.readdirSync(directory), [])
    })
  }
  if (failures.length) throw new Error(`${failures.length} provider security regression(s) failed: ${failures.join('; ')}`)
  console.log('provider-security: all offline checks passed; native OS encryption and real provider accounts were not exercised')
}
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
