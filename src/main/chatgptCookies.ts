/** Accepted subset of Network.CookieParam; secret values stay in the main process. */
export interface CdpCookie {
  name: string
  value: string
  url?: string
  domain?: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  expires?: number
}

export const CHATGPT_COOKIE_LIMITS = Object.freeze({ inputBytes: 2 * 1024 * 1024, entries: 2000, nameBytes: 256, valueBytes: 8192, pathBytes: 2048 })
export interface ChatGptCookieImport {
  cookies: CdpCookie[]
  total: number
  skipped: { unrelatedDomain: number; invalid: number; expired: number; duplicate: number }
}
type RecordValue = Record<string, unknown>
function record(value: unknown): value is RecordValue { return !!value && typeof value === 'object' && !Array.isArray(value) }

function decodeExport(raw: string): unknown[] {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > CHATGPT_COOKIE_LIMITS.inputBytes) {
    throw new Error('Cookie 导出文件过大，请只导出 ChatGPT 网站的 Cookie。')
  }
  let value: unknown = raw
  // Permit a copied JSON code block or a JSON string containing the export,
  // without repeatedly decoding arbitrary nesting or exposing parser errors.
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth++) {
    let text = value.trim().replace(/^\uFEFF/, '')
    const fence = /^```(?:json)?\s*\n?([\s\S]*?)\s*```$/i.exec(text)
    if (fence) text = fence[1].trim()
    try { value = JSON.parse(text) } catch { throw new Error('Cookie 导出内容不是有效的 JSON，请重新导出。') }
  }
  const entries = Array.isArray(value) ? value : record(value) && Array.isArray(value.cookies) ? value.cookies : null
  if (!entries) throw new Error('请选择 Cookie-Editor 导出的 JSON 数组或 cookies 列表。')
  if (entries.length > CHATGPT_COOKIE_LIMITS.entries) throw new Error('Cookie 条目过多，请只导出 ChatGPT 网站的 Cookie。')
  return entries
}

function normalizeDomain(value: unknown): { host: string; dotted: boolean } | null {
  if (typeof value !== 'string' || value.length > 254 || value !== value.trim()) return null
  const domain = value.toLowerCase()
  const dotted = domain.startsWith('.')
  const host = dotted ? domain.slice(1) : domain
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) return null
  return { host, dotted }
}

export function parseChatGptCookieImport(raw: string, nowSeconds = Date.now() / 1000): ChatGptCookieImport {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) throw new Error('无法核对 Cookie 有效期，请检查系统时间。')
  const entries = decodeExport(raw)
  const skipped = { unrelatedDomain: 0, invalid: 0, expired: 0, duplicate: 0 }
  const accepted = new Map<string, CdpCookie>()
  for (const entry of entries) {
    if (!record(entry)) { skipped.invalid++; continue }
    const scope = normalizeDomain(entry.domain)
    if (!scope) { skipped.invalid++; continue }
    if (scope.host !== 'chatgpt.com' && !scope.host.endsWith('.chatgpt.com')) { skipped.unrelatedDomain++; continue }
    const { name, value } = entry
    const cookiePath = entry.path === undefined ? '/' : entry.path
    // Do not silently widen a partitioned cookie into an unpartitioned one.
    // This import path restores first-party login cookies only.
    if (entry.partitionKey != null || entry.partitioned === true) { skipped.invalid++; continue }
    if (typeof name !== 'string' || !name || Buffer.byteLength(name, 'utf8') > CHATGPT_COOKIE_LIMITS.nameBytes
      || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
      || typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > CHATGPT_COOKIE_LIMITS.valueBytes
      || !/^(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/.test(value)
      || typeof cookiePath !== 'string' || !cookiePath.startsWith('/') || Buffer.byteLength(cookiePath, 'utf8') > CHATGPT_COOKIE_LIMITS.pathBytes
      || /[\x00-\x1f\x7f;]/u.test(cookiePath)
      || ['secure', 'httpOnly', 'hostOnly', 'session'].some(key => entry[key] !== undefined && typeof entry[key] !== 'boolean')) {
      skipped.invalid++; continue
    }
    const secure = entry.secure === true
    const httpOnly = entry.httpOnly === true
    const hostPrefix = name.startsWith('__Host-')
    const securePrefix = hostPrefix || name.startsWith('__Secure-') || name.startsWith('__Http-')
    if (securePrefix && !secure || hostPrefix && (cookiePath !== '/' || entry.hostOnly === false)
      || (name.startsWith('__Http-') || name.startsWith('__Host-Http-')) && !httpOnly) {
      skipped.invalid++; continue
    }
    let sameSite: CdpCookie['sameSite']
    const site = entry.sameSite
    if (site !== undefined && site !== null && site !== '') {
      if (typeof site !== 'string') { skipped.invalid++; continue }
      const normalized = site.toLowerCase()
      if (normalized === 'strict') sameSite = 'Strict'
      else if (normalized === 'lax') sameSite = 'Lax'
      else if (normalized === 'none' || normalized === 'no_restriction') sameSite = 'None'
      else if (normalized !== 'unspecified') { skipped.invalid++; continue }
    }
    if (sameSite === 'None' && !secure) { skipped.invalid++; continue }
    let expires: number | undefined
    if (entry.session !== true) {
      const expiration = entry.expirationDate ?? entry.expires
      if (expiration !== undefined && expiration !== null) {
        if (typeof expiration !== 'number' || !Number.isFinite(expiration) || expiration > 253402300799) { skipped.invalid++; continue }
        // CDP's -1 denotes a session cookie; Cookie-Editor uses session: true.
        if (expiration === -1 && entry.session !== false && entry.expirationDate === undefined) { /* no expires */ }
        else if (expiration <= nowSeconds) { skipped.expired++; continue }
        else expires = expiration
      } else if (entry.session === false) { skipped.invalid++; continue }
    }
    // Cookie-Editor reports hostOnly explicitly. For older exports, a leading
    // dot identifies a domain cookie; __Host- always remains host-only.
    const hostOnly = hostPrefix || entry.hostOnly === true || entry.hostOnly === undefined && !scope.dotted
    const cookie: CdpCookie = { name, value, path: cookiePath, secure, httpOnly,
      ...(hostOnly ? { url: `https://${scope.host}/` } : { domain: `.${scope.host}` }),
      ...(sameSite ? { sameSite } : {}), ...(expires === undefined ? {} : { expires }) }
    const identity = JSON.stringify([name, scope.host, hostOnly, cookiePath])
    if (accepted.has(identity)) skipped.duplicate++
    accepted.set(identity, cookie)
  }
  return { cookies: [...accepted.values()], total: entries.length, skipped }
}

export function parseChatGptCookies(raw: string): CdpCookie[] { return parseChatGptCookieImport(raw).cookies }
