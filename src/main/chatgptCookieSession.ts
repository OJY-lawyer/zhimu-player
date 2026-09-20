import { parseChatGptCookies, type CdpCookie } from './chatgptCookies'

export class ChatGptCookieImportError extends Error {}

interface CookieCdp { send(method: string, params?: Record<string, unknown>): Promise<unknown> }
interface ExistingCookie extends CdpCookie {
  domain: string
  session?: boolean
  partitionKey?: unknown
  partitionKeyOpaque?: boolean
  priority?: 'Low' | 'Medium' | 'High'
  sameParty?: boolean
  sourceScheme?: 'Unset' | 'NonSecure' | 'Secure'
  sourcePort?: number
}
type CookieSelector = { name: string; domain: string; path: string }
const INVALID = 'Cookie 导入内容无效，请重新导出 ChatGPT Cookie。'
const SNAPSHOT_FAILED = '无法读取播放器专用浏览器的原有 ChatGPT 登录态，未进行导入。'
const RESTORED = 'Cookie 导入未完成，已恢复导入前受影响的 ChatGPT Cookie。'
const RESTORE_FAILED = 'Cookie 导入未完成，原有 ChatGPT Cookie 未能全部恢复；请在专用浏览器中重新检查登录。'
// Chromium caps persistent cookies at 400 days; normalize before writing so
// read-back remains exact instead of mistaking that documented cap for failure.
const MAX_COOKIE_LIFETIME_SECONDS = 400 * 24 * 60 * 60
const chatGptDomain = (domain: string) => {
  const host = domain.replace(/^\./, '').toLowerCase()
  return host === 'chatgpt.com' || host.endsWith('.chatgpt.com')
}
function selector(cookie: CdpCookie): CookieSelector {
  return { name: cookie.name, domain: cookie.domain || new URL(cookie.url!).hostname, path: cookie.path }
}
function key(cookie: CookieSelector): string { return JSON.stringify([cookie.name, cookie.domain.toLowerCase(), cookie.path]) }
function authFamily(name: string): string | null {
  // Scope deliberately includes the exact prefix/provider. Different cookie
  // names, domains or paths are not an implicit authorization to log them out.
  return /^(?:(?:__Secure-|__Host-)?(?:next-auth|authjs)\.session-token)(?:\.\d+)?$/.test(name)
    ? name.replace(/\.\d+$/, '') : null
}
function normalizeInput(cookies: CdpCookie[]): CdpCookie[] {
  try {
    if (!Array.isArray(cookies) || !cookies.length) throw new Error()
    const exported = cookies.map(cookie => {
      if (!cookie || typeof cookie !== 'object' || Boolean(cookie.url) === Boolean(cookie.domain)) throw new Error()
      let domain = cookie.domain
      if (cookie.url) {
        const url = new URL(cookie.url)
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error()
        domain = url.hostname
      }
      return { ...cookie, domain, hostOnly: !!cookie.url, session: cookie.expires === undefined }
    })
    const normalized = parseChatGptCookies(JSON.stringify(exported))
    if (normalized.length !== cookies.length) throw new Error()
    // A query or fragment cannot be represented in an exact request-path URL.
    if (normalized.some(cookie => /[?#]/.test(cookie.path))) throw new Error()
    const maxExpires = Date.now() / 1000 + MAX_COOKIE_LIFETIME_SECONDS
    return normalized.map(cookie => ({ ...cookie,
      // CDP derives Secure from an https URL even when secure:false is explicit.
      // This URL is cookie metadata only: it is never navigated or requested.
      ...(cookie.url && !cookie.secure ? { url: cookie.url.replace(/^https:/, 'http:') } : {}),
      ...(cookie.expires === undefined ? {} : { expires: Math.min(cookie.expires, maxExpires) }),
    }))
  } catch { throw new ChatGptCookieImportError(INVALID) }
}
function probeUrls(cookies: CdpCookie[]): string[] {
  return [...new Set(cookies.map(cookie => {
    const scope = selector(cookie)
    const url = new URL(`https://${scope.domain.replace(/^\./, '')}/`)
    url.pathname = scope.path
    if (url.pathname !== scope.path) throw new ChatGptCookieImportError(INVALID)
    return url.href
  }))]
}
async function readCookies(cdp: CookieCdp, urls: string[]): Promise<ExistingCookie[]> {
  const response = await cdp.send('Network.getCookies', { urls }) as { cookies?: unknown }
  if (!response || !Array.isArray(response.cookies) || response.cookies.length > 5000) throw new Error()
  return response.cookies.filter((value): value is ExistingCookie => {
    if (!value || typeof value !== 'object') throw new Error()
    const cookie = value as ExistingCookie
    if (typeof cookie.domain !== 'string') throw new Error()
    if (!chatGptDomain(cookie.domain)) return false
    if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.path !== 'string'
      || !cookie.path.startsWith('/') || typeof cookie.secure !== 'boolean' || typeof cookie.httpOnly !== 'boolean') throw new Error()
    return true
  })
}
function restoration(cookie: ExistingCookie): CdpCookie & Record<string, unknown> {
  const hostOnly = !cookie.domain.startsWith('.') || cookie.name.startsWith('__Host-')
  return { name: cookie.name, value: cookie.value, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
    ...(hostOnly ? { url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}/` } : { domain: cookie.domain }),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
    ...(!cookie.session && typeof cookie.expires === 'number' && cookie.expires > 0 ? { expires: cookie.expires } : {}),
    ...(cookie.priority ? { priority: cookie.priority } : {}),
    ...(typeof cookie.sameParty === 'boolean' ? { sameParty: cookie.sameParty } : {}),
    ...(cookie.sourceScheme ? { sourceScheme: cookie.sourceScheme } : {}),
    ...(Number.isInteger(cookie.sourcePort) ? { sourcePort: cookie.sourcePort } : {}),
  }
}
function sameCookie(actual: ExistingCookie | undefined, expected: CdpCookie): boolean {
  return !!actual && actual.value === expected.value && actual.secure === expected.secure && actual.httpOnly === expected.httpOnly
    && (expected.sameSite === undefined || actual.sameSite === expected.sameSite)
    && (expected.expires === undefined || expected.expires <= 0
      ? actual.session === true || actual.expires === undefined || actual.expires <= 0
      : actual.session !== true && typeof actual.expires === 'number' && actual.expires > Date.now() / 1000 && Math.abs(actual.expires - expected.expires) < 1)
}

/**
 * The caller owns lifecycle/serialization and must supply a page-session CDP
 * adapter attached to about:blank in the PLAYER'S dedicated profile. This
 * helper neither launches a browser nor navigates or reads another profile.
 * CDP has no cookie transaction: rollback is best-effort if the connection dies.
 */
export async function applyChatGptCookies(cdp: CookieCdp, cookies: CdpCookie[]): Promise<void> {
  const imported = normalizeInput(cookies)
  const urls = probeUrls(imported)
  const targets = imported.map(selector)
  const matches = (cookie: ExistingCookie) => targets.some(target => {
    if (cookie.path !== target.path) return false
    const family = authFamily(target.name)
    if (family !== null && authFamily(cookie.name) === family) {
      // A stale domain-cookie auth shard also competes with a new host-only
      // token on the SAME host. Only known auth families cross this scope seam.
      return cookie.domain.toLowerCase().replace(/^\./, '') === target.domain.toLowerCase().replace(/^\./, '')
    }
    return cookie.name === target.name && cookie.domain.toLowerCase() === target.domain.toLowerCase()
  })
  let backup: ExistingCookie[]
  try {
    const existing = await readCookies(cdp, urls)
    backup = existing.filter(matches).map(cookie => ({ ...cookie }))
    // Omitting a partition key in deleteCookies could broaden the delete scope.
    // Reject before mutation instead of converting or removing partitioned data.
    if (backup.some(cookie => cookie.partitionKey != null || cookie.partitionKeyOpaque)) throw new Error()
  } catch { throw new ChatGptCookieImportError(SNAPSHOT_FAILED) }
  const affected = new Map<string, CookieSelector>()
  for (const cookie of [...backup, ...imported]) { const scope = selector(cookie); affected.set(key(scope), scope) }
  const oldKeys = new Set(backup.map(cookie => key(selector(cookie))))
  const newKeys = new Set(imported.map(cookie => key(selector(cookie))))
  let mutated = false
  try {
    // Only remove existing affected entries; this also removes stale auth chunks.
    for (const cookie of backup) { mutated = true; await cdp.send('Network.deleteCookies', selector(cookie)) }
    mutated = true
    await cdp.send('Network.setCookies', { cookies: imported })
    const after = await readCookies(cdp, urls)
    const byKey = new Map(after.map(cookie => [key(selector(cookie)), cookie]))
    if (imported.some(cookie => !sameCookie(byKey.get(key(selector(cookie))), cookie))
      || after.some(cookie => matches(cookie) && !newKeys.has(key(selector(cookie))))) throw new Error()
  } catch {
    if (!mutated) throw new ChatGptCookieImportError(SNAPSHOT_FAILED)
    // A failed batch can have set a prefix of its cookies. Remove every exact
    // affected identity, then restore each backup independently so one error
    // does not prevent other recoverable entries from being put back.
    let restored = true
    for (const scope of affected.values()) {
      try { await cdp.send('Network.deleteCookies', scope) } catch { restored = false }
    }
    for (const cookie of backup) {
      try { await cdp.send('Network.setCookies', { cookies: [restoration(cookie)] }) } catch { restored = false }
    }
    try {
      const after = await readCookies(cdp, urls)
      const byKey = new Map(after.map(cookie => [key(selector(cookie)), cookie]))
      if (backup.some(cookie => !sameCookie(byKey.get(key(selector(cookie))), cookie))
        || after.some(cookie => affected.has(key(selector(cookie))) && !oldKeys.has(key(selector(cookie))))) restored = false
    } catch { restored = false }
    throw new ChatGptCookieImportError(restored ? RESTORED : RESTORE_FAILED)
  }
}
