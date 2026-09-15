import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { isUtf8 } from 'node:buffer'
import type { ApiModelsRequest, ApiModelsResult } from '../shared/contracts'
import { resolveDraftApiKey } from './configStore'

export function normalizeApiEndpoint(input: string): string {
  const url = new URL(input.trim())
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含凭据、查询参数或片段。')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('API 必须使用 HTTPS，本机服务可使用 HTTP。')
  }
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/chat/completions') ? pathname : pathname + '/chat/completions'
  return url.toString()
}

export function normalizeModelsEndpoint(input: string): string {
  const url = new URL(normalizeApiEndpoint(input))
  url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models')
  return url.toString()
}

type ModelError = NonNullable<ApiModelsResult['error']>
class ModelFailure extends Error {
  constructor(readonly code: ModelError, readonly canUseCache = false) { super(code) }
}
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_MODELS = 1000
const MAX_CACHE_ENTRIES = 32

/** Model IDs are opaque identifiers. Do not infer their abilities or constrain future names. */
export function parseApiModels(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) throw new ModelFailure('invalid-response')
  const data = (body as { data: unknown[] }).data
  if (data.length > MAX_MODELS) throw new ModelFailure('invalid-response')
  const models = new Set<string>()
  for (const row of data) {
    if (!row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string') throw new ModelFailure('invalid-response')
    const id = (row as { id: string }).id.trim()
    if (!id || id.length > 256 || /[\s\p{Cc}\p{Cf}\p{Cs}]/u.test(id)) throw new ModelFailure('invalid-response')
    models.add(id)
  }
  return [...models]
}

function untilAborted<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ModelFailure('unavailable'))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) throw new ModelFailure('invalid-response')
  if (!response.body) throw new ModelFailure('invalid-response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let complete = false
  try {
    for (;;) {
      const next = await untilAborted(reader.read(), signal)
      if (next.done) { complete = true; break }
      length += next.value.byteLength
      if (length > MAX_RESPONSE_BYTES) throw new ModelFailure('invalid-response')
      chunks.push(next.value)
    }
    const bytes = Buffer.concat(chunks, length)
    if (!isUtf8(bytes)) throw new ModelFailure('invalid-response')
    try { return JSON.parse(bytes.toString('utf8')) } catch { throw new ModelFailure('invalid-response') }
  } finally {
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createApiModelsService(options: {
  fetcher?: typeof fetch
  resolveKey?: typeof resolveDraftApiKey
  timeoutMs?: number
  now?: () => Date
} = {}) {
  const fetcher = options.fetcher || fetch
  const resolveKey = options.resolveKey || resolveDraftApiKey
  const now = options.now || (() => new Date())
  // This cache is private to the current launch. Never persist a model-account mapping.
  const cache = new Map<string, { models: string[]; fetchedAt: string }>()
  const active = new Set<AbortController>()
  const latestRequests = new Map<string, number>()
  let sequence = 0
  let disposed = false

  async function list(request: ApiModelsRequest): Promise<ApiModelsResult> {
    let endpoint: string
    try {
      if (!request || typeof request.baseUrl !== 'string' || request.baseUrl.length > 4096) throw new Error('invalid')
      endpoint = normalizeModelsEndpoint(request.baseUrl)
    } catch { return { models: [], source: 'none', error: 'invalid-url' } }
    let key: string
    try {
      if (typeof request.apiKey !== 'string' || request.apiKey.length > 8192 || (request.clearApiKey !== undefined && typeof request.clearApiKey !== 'boolean')) throw new Error('invalid')
      key = resolveKey(request)
      if (/[\r\n\u0000]/.test(key)) throw new Error('invalid')
      if (!key && ['api.deepseek.com', 'api.openai.com'].includes(new URL(endpoint).hostname)) throw new Error('required')
    } catch { return { models: [], source: 'none', error: 'credentials' } }
    if (disposed) return { models: [], source: 'none', error: 'unavailable' }

    const cacheKey = endpoint + '\n' + createHash('sha256').update(key).digest('hex')
    const requestToken = ++sequence
    latestRequests.set(cacheKey, requestToken)
    const isLatest = () => latestRequests.get(cacheKey) === requestToken
    const controller = new AbortController()
    active.add(controller)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.timeoutMs ?? 15_000)
    let response: Response | undefined
    try {
      try {
        response = await untilAborted(fetcher(endpoint, { method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) } }), controller.signal)
      } catch { throw new ModelFailure('unavailable', true) }
      if (response.status === 401 || response.status === 403) {
        if (isLatest()) cache.delete(cacheKey)
        throw new ModelFailure('unauthorized')
      }
      if (!response.ok) throw new ModelFailure('unavailable', response.status === 429 || response.status >= 500)
      let body: unknown
      try { body = await readBoundedJson(response, controller.signal) }
      catch (error) {
        if (error instanceof ModelFailure) throw error
        throw new ModelFailure('unavailable', true)
      }
      if (controller.signal.aborted) throw new ModelFailure('unavailable')
      const models = parseApiModels(body)
      // Avoid exposing a credential even if a malformed service echoes it as a model ID.
      if (key && models.some(id => id.includes(key))) throw new ModelFailure('invalid-response')
      const entry = { models: [...models], fetchedAt: now().toISOString() }
      if (isLatest()) {
        cache.delete(cacheKey)
        cache.set(cacheKey, entry)
        if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
      }
      return { models, source: 'live', fetchedAt: entry.fetchedAt }
    } catch (error) {
      const code: ModelError = timedOut ? 'timeout' : error instanceof ModelFailure ? error.code : 'unavailable'
      const entry = !disposed && (timedOut || error instanceof ModelFailure && error.canUseCache) ? cache.get(cacheKey) : undefined
      return entry ? { models: [...entry.models], source: 'cache', fetchedAt: entry.fetchedAt, error: code }
        : { models: [], source: 'none', error: code }
    } finally {
      clearTimeout(timer)
      controller.abort()
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {})
      active.delete(controller)
      // Only in-flight destinations need a generation record; older completions stay stale.
      if (isLatest()) latestRequests.delete(cacheKey)
    }
  }
  return {
    list,
    dispose() { disposed = true; for (const controller of active) controller.abort(); cache.clear(); latestRequests.clear() },
  }
}

export function registerApiModels(): void {
  const service = createApiModelsService()
  ipcMain.handle('api-models', (_event, request: ApiModelsRequest) => service.list(request))
  app.on('before-quit', () => service.dispose())
}
