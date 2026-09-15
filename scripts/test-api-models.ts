import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { transformSync } = hostRequire('esbuild') as typeof import('esbuild')

function makeHost() {
  const files = new Map<string, string>()
  const handlers = new Map<string, (...args: any[]) => any>()
  const quitHandlers: (() => void)[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  let decryptions = 0
  let fetcher: typeof fetch = async () => { throw new Error('unmocked network is forbidden') }
  const disk = {
    readFileSync: (file: string) => {
      const value = files.get(file)
      if (value === undefined) throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' })
      return value
    },
    writeFileSync: (file: string, value: string) => files.set(file, value),
    renameSync: (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from) },
  }
  const electron = {
    app: { getPath: () => path.join(root, 'work', 'virtual-api-models-fixture'), on: (event: string, callback: () => void) => { if (event === 'before-quit') quitHandlers.push(callback) } },
    ipcMain: { handle: (event: string, callback: (...args: any[]) => any) => handlers.set(event, callback) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => { decryptions++; return value.toString() } },
  }
  const context = vm.createContext({ console, Buffer, URL, AbortController, DOMException, Response,
    fetch: (...args: Parameters<typeof fetch>) => fetcher(...args),
    setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id },
    clearTimeout: (id: number) => timers.delete(id),
  })
  const cache = new Map<string, { exports: any }>()
  function load(relative: string): any {
    const file = path.resolve(root, relative)
    if (cache.has(file)) return cache.get(file)!.exports
    const module = { exports: {} as any }
    cache.set(file, module)
    const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code
    const requireModule = (name: string): any => {
      if (name === 'electron') return electron
      if (name === 'node:fs') return disk
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'))
      return hostRequire(name)
    }
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(requireModule, module, module.exports)
    return module.exports
  }
  return { load, handlers, timers, quitHandlers, files, get decryptions() { return decryptions },
    setFetch(value: typeof fetch) { fetcher = value },
    expire() { for (const timer of [...timers.values()]) timer() },
  }
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
const ok = (ids: string[]) => new Response(JSON.stringify({ data: ids.map(id => ({ id, owned_by: 'ignored-account-field' })) }), { headers: { 'Content-Type': 'application/json' } })
const draft = (apiKey = 'fixture-model-key-a', baseUrl = 'https://api.deepseek.com/v1/chat/completions') => ({ baseUrl, apiKey })

async function main() {
  const host = makeHost()
  const config = host.load('src/main/configStore.ts')
  const api = host.load('src/main/apiModels.ts')
  config.saveConfig({ provider: 'compatible-api', baseUrl: 'https://api.deepseek.com', model: 'manual-model', apiKey: 'fixture-saved-key' })
  const before = [...host.files.entries()]
  assert.equal(config.resolveDraftApiKey(draft('', 'https://api.deepseek.com/v1')), 'fixture-saved-key')
  assert.equal(config.resolveDraftApiKey({ ...draft('fixture-replacement-key'), clearApiKey: true }), '')
  const reads = host.decryptions
  assert.equal(config.resolveDraftApiKey(draft('', 'https://other-provider.example/v1')), '')
  assert.equal(host.decryptions, reads, 'changed origin must not decrypt the saved key')
  assert.equal(config.resolveDraftApiKey(draft(' fixture-draft-key ')), 'fixture-draft-key')
  assert.deepEqual([...host.files.entries()], before, 'discovery must not change saved configuration')
  assert.equal(config.loadConfig().apiKey, '', 'saved keys never return to the renderer')
  config.saveConfig({ provider: 'compatible-api', ...draft(' fixture-pasted-key '), model: 'manual-model' })
  assert.equal(config.loadConfig(true).apiKey, 'fixture-pasted-key', 'saved keys use the same whitespace normalization as discovery')
  assert.equal(config.resolveDraftApiKey(draft('')), 'fixture-pasted-key')
  config.saveConfig({ provider: 'compatible-api', ...draft('  '), model: 'manual-model' })
  assert.equal(config.loadConfig(true).apiKey, 'fixture-pasted-key', 'blank drafts retain the same-origin stored key')
  config.saveConfig({ provider: 'compatible-api', ...draft(' fixture-new-but-cleared '), model: 'manual-model', clearApiKey: true })
  assert.equal(config.loadConfig(true).apiKey, '', 'explicit clearing still takes priority over a pasted key')

  assert.equal(api.normalizeModelsEndpoint('https://api.deepseek.com'), 'https://api.deepseek.com/models')
  assert.equal(api.normalizeModelsEndpoint('https://api.deepseek.com/v1/chat/completions/'), 'https://api.deepseek.com/v1/models')
  assert.equal(api.normalizeModelsEndpoint('http://[::1]:8181/api/v1/'), 'http://[::1]:8181/api/v1/models')
  for (const url of ['http://provider.example', 'https://user:pass@provider.example', 'https://provider.example?key=private', 'https://provider.example/#fragment']) assert.throws(() => api.normalizeModelsEndpoint(url))

  const service = api.createApiModelsService({ now: () => new Date('2026-09-14T10:00:00Z') })
  let calls = 0
  host.setFetch(async (url, options) => {
    calls++
    assert.equal(String(url), 'https://api.deepseek.com/v1/models')
    assert.equal(options?.method, 'GET')
    assert.equal(options?.redirect, 'error')
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer fixture-model-key-a')
    return ok([' deepseek-future-model ', 'vendor/new-model:1', 'deepseek-future-model'])
  })
  const live = await service.list(draft())
  assert.deepEqual(plain(live), { models: ['deepseek-future-model', 'vendor/new-model:1'], source: 'live', fetchedAt: '2026-09-14T10:00:00.000Z' })
  assert.equal(host.timers.size, 0)
  host.setFetch(async () => { throw new Error('fixture-model-key-a must never leave in an error') })
  const cached = await service.list(draft())
  assert.deepEqual(plain(cached), { ...plain(live), source: 'cache', error: 'unavailable' })
  assert.equal((await service.list(draft('fixture-model-key-b'))).source, 'none', 'different accounts do not share cache')
  assert.equal((await service.list(draft('fixture-model-key-a', 'https://other-provider.example/v1'))).source, 'none', 'different endpoints do not share cache')
  assert.equal((await api.createApiModelsService().list(draft())).source, 'none', 'cache belongs to one service lifetime')
  assert(!JSON.stringify(cached).includes('fixture-model-key-a'))

  for (const status of [429, 500, 503]) {
    host.setFetch(async () => new Response('sensitive provider response', { status }))
    assert.equal((await service.list(draft())).source, 'cache')
  }
  host.setFetch(async () => new Response('private error details', { status: 400 }))
  assert.equal((await service.list(draft())).source, 'none', 'client errors are not transient cache fallbacks')
  for (const status of [401, 403]) {
    host.setFetch(async () => ok(['fresh-model']))
    await service.list(draft())
    host.setFetch(async () => new Response('private account details', { status }))
    assert.deepEqual(plain(await service.list(draft())), { models: [], source: 'none', error: 'unauthorized' })
    host.setFetch(async () => { throw new Error('offline') })
    assert.equal((await service.list(draft())).source, 'none', 'unauthorized responses invalidate this account cache')
  }

  let releaseOlder!: (response: Response) => void
  host.setFetch(async () => new Promise<Response>(resolve => { releaseOlder = resolve }))
  const olderSuccess = service.list(draft())
  host.setFetch(async () => new Response('private rejection details', { status: 401 }))
  assert.equal((await service.list(draft())).error, 'unauthorized')
  releaseOlder(ok(['stale-success-after-new-401']))
  await olderSuccess
  host.setFetch(async () => { throw new Error('offline') })
  assert.equal((await service.list(draft())).source, 'none', 'an older success must not restore cache after a newer unauthorized response')

  host.setFetch(async () => new Promise<Response>(resolve => { releaseOlder = resolve }))
  const olderRejection = service.list(draft())
  host.setFetch(async () => ok(['newer-success']))
  await service.list(draft())
  releaseOlder(new Response('private stale rejection', { status: 403 }))
  await olderRejection
  host.setFetch(async () => { throw new Error('offline') })
  assert.deepEqual(plain((await service.list(draft())).models), ['newer-success'], 'an older rejection must not clear a newer successful cache')

  host.setFetch(async () => ok([]))
  assert.deepEqual(plain((await service.list(draft())).models), [], 'successful empty discovery remains empty')
  for (const body of [{}, { data: [{ id: '' }] }, { data: [{ id: 'two words' }] }, { data: [{ id: 'bad\u202eid' }] }, { data: [{ id: 1 }] }, { data: Array.from({ length: 1001 }, () => ({ id: 'm' })) }]) {
    host.setFetch(async () => new Response(JSON.stringify(body)))
    assert.deepEqual(plain(await service.list(draft())), { models: [], source: 'none', error: 'invalid-response' })
  }
  for (const response of [new Response('{'), new Response(Uint8Array.of(0xff)), new Response('a'.repeat(1024 * 1024 + 1)), new Response('{}', { headers: { 'content-length': '2000000' } }), ok(['fixture-model-key-a'])]) {
    host.setFetch(async () => response)
    assert.equal((await service.list(draft())).error, 'invalid-response')
  }

  host.setFetch(async () => ok(['cached-before-timeout']))
  await service.list(draft())
  let bodyStarted!: () => void
  const started = new Promise<void>(resolve => { bodyStarted = resolve })
  let cancelled = false
  host.setFetch(async () => new Response(new ReadableStream({ start() { bodyStarted() }, cancel() { cancelled = true } })))
  const pending = service.list(draft())
  await started
  host.expire()
  const timeout = await pending
  assert.equal(timeout.error, 'timeout')
  assert.equal(timeout.source, 'cache', 'body deadline uses the same-account fallback')
  assert(cancelled, 'a timed-out response body must be cancelled')
  assert.equal(host.timers.size, 0)

  const noKeyHost = makeHost()
  const noKeyService = noKeyHost.load('src/main/apiModels.ts').createApiModelsService()
  let noKeyRequests = 0
  noKeyHost.setFetch(async (_url, options) => { noKeyRequests++; assert.equal((options?.headers as Record<string, string>).Authorization, undefined); return ok(['local-model']) })
  assert.equal((await noKeyService.list(draft(''))).error, 'credentials')
  assert.equal(noKeyRequests, 0)
  assert.equal((await noKeyService.list(draft('', 'http://localhost:8080/v1'))).source, 'live')
  assert.equal((await service.list({ ...draft(), clearApiKey: true })).error, 'credentials')

  const ipcHost = makeHost()
  ipcHost.load('src/main/apiGuide.ts').registerApiGuide()
  assert(ipcHost.handlers.has('api-models'), 'registering guides registers model discovery')
  let fetchStarted!: () => void
  const waiting = new Promise<void>(resolve => { fetchStarted = resolve })
  let aborted = false
  ipcHost.setFetch(async (_url, options) => {
    options?.signal?.addEventListener('abort', () => { aborted = true }, { once: true })
    fetchStarted()
    return new Promise<Response>(() => {})
  })
  const quitting = ipcHost.handlers.get('api-models')!({}, draft())
  await waiting
  for (const quit of ipcHost.quitHandlers) quit()
  assert.equal((await quitting).error, 'unavailable')
  assert(aborted)
  assert.equal(ipcHost.timers.size, 0)

  const { requestCompletion } = host.load('src/main/apiGuide.ts')
  let postedModel = ''
  const guide = await requestCompletion({ ...draft(), model: 'deepseek-model-not-known-at-build-time' }, [], new AbortController().signal,
    async (_url: string, options: RequestInit) => { postedModel = JSON.parse(String(options.body)).model; return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'guide' } }] }) } })
  assert.equal(guide, 'guide')
  assert.equal(postedModel, 'deepseek-model-not-known-at-build-time', 'manual and future model IDs must reach the API unchanged')
  assert.equal(calls, 1)
  console.log('api-models: discovery, endpoint/account isolation, draft key safety, bounded responses, timeout/quit cleanup, cache rules and future model IDs passed; offline fixtures only')
}
const watchdog = setTimeout(() => { console.error('api-models: offline tests timed out'); process.exit(1) }, 8000)
void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
