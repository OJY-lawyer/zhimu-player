import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildOssUpload, delay, inspectTingwuMedia, TingwuClient, TingwuError, tingwuResultToSrt, type TingwuFetch } from '../src/main/tingwuClient'

async function main(): Promise<void> {
  const calls: { url: string; options: RequestInit }[] = []
  const responses: unknown[] = [
    { code: '0', data: { id: 'test-user' } },
    { code: '0', data: { transId: 'test-task', putLink: 'https://test.oss-cn-hangzhou.aliyuncs.com/video.mp4' } },
    { code: '0', data: {} },
    { code: '0', data: [{ transId: 'test-task', status: 3 }] },
    { code: '0', data: { result: JSON.stringify({ pg: [{ sc: [{ bt: 120, et: 1540, tc: '你好。' }] }] }), wordCount: 3, duration: 2 } },
  ]
  const fetcher: TingwuFetch = async (url, options) => {
    calls.push({ url, options })
    assert.ok(responses.length, 'unexpected request')
    return { ok: true, status: 200, json: async () => responses.shift() }
  }
  const client = new TingwuClient(fetcher)
  const signal = new AbortController().signal
  assert.deepEqual(await client.probe(), { success: true, authenticated: true, message: '听悟已登录，可以生成字幕。' })
  const upload = await client.generateUpload(path.resolve('work', '测试.mp4'), 123, 'video/mp4', 'local-test-id', signal)
  await client.confirmUpload(upload, 123, signal)
  const srt = await client.waitForSrt(upload.transId, signal, () => {})
  assert.equal(srt, '1\n00:00:00,120 --> 00:00:01,540\n你好。\n')
  assert.equal(responses.length, 0)
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/api/account/v2/user/info', '/api/trans/request', '/api/trans/request', '/api/trans/request', '/api/trans/getTransResult',
  ])
  for (const call of calls) {
    assert.equal(call.options.credentials, 'include')
    assert.equal(call.options.redirect, 'error')
    assert.equal(new URL(call.url).origin, 'https://tingwu.aliyun.com')
    assert.equal((call.options.headers as Record<string, string>).Cookie, undefined)
  }
  const generateBody = JSON.parse(String(calls[1].options.body))
  assert.equal(generateBody.dirId, 0)
  assert.equal(generateBody.taskId, 'local-test-id')
  assert.equal(generateBody.fileSize, 123)
  assert.equal(generateBody.tag.roleSplitNum, 2)
  assert.equal(generateBody.tag.lang, 'cn')
  assert.equal(generateBody.tag.originalTag, '{"isVideo":1}')
  assert.equal(JSON.parse(String(calls[2].options.body)).action, 'syncPutLink')
  assert.ok(!calls.some(call => String(call.options.body).includes('startTrans')))

  let englishBody: any
  const englishClient = new TingwuClient(async (_url, options) => {
    englishBody = JSON.parse(String(options.body))
    return { ok: true, status: 200, json: async () => ({ code: '0', data: { transId: 'english-task' } }) }
  })
  await englishClient.generateUpload(path.resolve('work', 'english.mp4'), 123, 'video/mp4', 'english-local-id', signal, 'en')
  assert.equal(englishBody.tag.lang, 'en')
  assert.equal(englishBody.tag.translateSwitch, false, 'speech language must not silently enable translation')

  const noAuth = new TingwuClient(async () => ({ ok: false, status: 401, json: async () => { throw new Error('should not read') } }))
  assert.equal((await noAuth.probe()).authenticated, false)
  const secretFailure = new TingwuClient(async () => ({ ok: true, status: 200,
    json: async () => ({ code: 'FAIL', message: 'secret-token=DO_NOT_EXPOSE' }) }))
  assert.ok(!(await secretFailure.probe()).message.includes('DO_NOT_EXPOSE'))
  const emptyAccount = new TingwuClient(async () => ({ ok: true, status: 200, json: async () => ({ code: '0', data: {} }) }))
  assert.equal((await emptyAccount.probe()).authenticated, false)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(() => delay(5000, abort.signal), { name: 'AbortError' })
  await assert.rejects(() => client.taskStatus('none', abort.signal), { name: 'AbortError' })

  const fixture = { transId: 'test-task', sts: { endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    bucket: 'test-bucket', fileKey: 'recordings/测试 file.mp4', accessKeyId: 'fixture-key',
    accessKeySecret: 'fixture-secret', securityToken: 'fixture-token' } }
  const signed = buildOssUpload(fixture, 'video/mp4', 'Mon, 14 Sep 2026 00:00:00 GMT')
  assert.equal(signed.url.href, 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/recordings/%E6%B5%8B%E8%AF%95%20file.mp4')
  // Fixture checked independently with .NET HMACSHA1 and the documented canonical fields.
  assert.equal(signed.headers.Authorization, 'OSS fixture-key:nxZSxpswFAwnbmUh8PIFCzO5oTs=')
  assert.equal(signed.headers['x-oss-security-token'], 'fixture-token')
  assert.equal(signed.headers.Cookie, undefined)
  for (const endpoint of ['https://example.com', 'https://oss-cn-hangzhou.aliyuncs.com.evil.com',
    'https://user:pass@oss-cn-hangzhou.aliyuncs.com', 'https://oss-cn-hangzhou.aliyuncs.com/other', 'https://127.0.0.1']) {
    assert.throws(() => buildOssUpload({ ...fixture, sts: { ...fixture.sts, endpoint } }, 'video/mp4'), TingwuError)
  }
  assert.throws(() => buildOssUpload({ ...fixture, sts: { ...fixture.sts, fileKey: '../secret' } }, 'video/mp4'), TingwuError)
  assert.throws(() => buildOssUpload({ transId: 't', putLink: 'http://example.com' }, 'video/mp4'), TingwuError)
  const signedUrl = 'https://test-bucket.oss-cn-hangzhou.aliyuncs.com/file.mp4?Signature=fixture'
  assert.equal(buildOssUpload({ transId: 't', putLink: signedUrl }, 'video/mp4').url.href, signedUrl)

  assert.equal(tingwuResultToSrt('{}'), '')
  assert.equal(tingwuResultToSrt('invalid'), '')
  assert.equal(tingwuResultToSrt({ pg: [{ sc: [{ tc: '没有时间戳' }, { bt: -1, et: 9, tc: '坏数据' }] }] }), '')
  const split = tingwuResultToSrt({ pg: [{ sc: [
    { bt: 0, et: 1800, tc: '第一句。' }, { bt: 1900, et: 2100, tc: '第二句！' },
  ] }] })
  assert.match(split, /00:00:01,900 --> 00:00:02,100/)
  assert.ok(!split.includes('00:00:02,900'), 'short cues retain source timestamps instead of overlapping')
  const testDirectory = await fs.mkdtemp(path.resolve('work', 'tingwu-test-'))
  try {
    const media = path.join(testDirectory, '测试.mp4')
    await fs.writeFile(media, 'mock media: never uploaded')
    const before = await inspectTingwuMedia(media)
    assert.equal(before.contentType, 'video/mp4')
    assert.equal(before.key.length, 64)
    await fs.appendFile(media, 'changed')
    assert.notEqual((await inspectTingwuMedia(media)).key, before.key)
    await assert.rejects(() => inspectTingwuMedia(path.join(testDirectory, 'unsupported.ts')), TingwuError)
  } finally { await fs.rm(testDirectory, { recursive: true, force: true }) }
  console.log('tingwu-client: offline protocol, auth, cancellation, OSS destination/signature, SRT and file validation passed')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
