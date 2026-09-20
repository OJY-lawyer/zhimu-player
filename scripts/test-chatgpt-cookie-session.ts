import assert from 'node:assert/strict'
import { applyChatGptCookies } from '../src/main/chatgptCookieSession'
import type { CdpCookie } from '../src/main/chatgptCookies'

const old = (name: string, value = 'old-synthetic', domain = 'chatgpt.com', cookiePath = '/') => ({ name, value, domain, path: cookiePath,
  secure: true, httpOnly: true, session: true, expires: -1, sameSite: 'Lax' as const, priority: 'High', sourceScheme: 'Secure', sourcePort: 443 })
const imported = (name: string, value = 'new-synthetic', host = 'chatgpt.com', cookiePath = '/'): CdpCookie => ({
  name, value, url: `https://${host}/`, path: cookiePath, secure: true, httpOnly: true, sameSite: 'Lax',
})
const identity = (cookie: { name: string; domain: string; path: string }) => JSON.stringify([cookie.name, cookie.domain, cookie.path])
class MockCdp {
  jar = new Map<string, any>()
  calls: { method: string; params: Record<string, any> }[] = []
  failRead = false
  failSetOnce = false
  skipSetOnce = false
  disconnectAfterSet = false
  disconnected = false
  failDeleteAt = -1
  deleteCalls = 0
  constructor(cookies: any[]) { cookies.forEach(cookie => this.jar.set(identity(cookie), { ...cookie })) }
  snapshot() { return [...this.jar.values()].map(cookie => ({ ...cookie })).sort((a, b) => identity(a).localeCompare(identity(b))) }
  async send(method: string, params: Record<string, any> = {}): Promise<unknown> {
    this.calls.push({ method, params })
    assert(!/clear|getAll|Storage\./.test(method), 'never enumerate or clear the entire browser cookie jar')
    if (this.disconnected) throw new Error('disconnected with secret-value-must-not-escape')
    if (method === 'Network.getCookies') {
      if (this.failRead) throw new Error('secret-value-must-not-escape')
      assert(params.urls.length)
      for (const value of params.urls) { const url = new URL(value); assert(url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')); assert.equal(url.protocol, 'https:') }
      // Intentionally include unrelated entries to verify defensive filtering.
      return { cookies: this.snapshot() }
    }
    if (method === 'Network.deleteCookies') {
      assert.deepEqual(Object.keys(params).sort(), ['domain', 'name', 'path'])
      assert(params.domain === 'chatgpt.com' || params.domain.endsWith('.chatgpt.com'))
      this.deleteCalls++
      if (this.deleteCalls === this.failDeleteAt) throw new Error('secret-value-must-not-escape')
      this.jar.delete(identity(params as any)); return {}
    }
    if (method === 'Network.setCookies') {
      const values = params.cookies as (CdpCookie & Record<string, any>)[]
      if (this.skipSetOnce) { this.skipSetOnce = false; return {} }
      for (const cookie of values) {
        const domain = cookie.domain || new URL(cookie.url!).hostname
        const stored = { ...old(cookie.name, cookie.value, domain, cookie.path), ...cookie, domain,
          // Match real Chromium: an HTTPS source URL forces Secure even when false is supplied.
          secure: cookie.secure || !!cookie.url?.startsWith('https:'),
          session: cookie.expires === undefined, expires: cookie.expires ?? -1 }
        delete stored.url
        this.jar.set(identity(stored), stored)
        if (this.failSetOnce) {
          this.failSetOnce = false
          if (this.disconnectAfterSet) this.disconnected = true
          throw new Error('partial write secret-value-must-not-escape')
        }
      }
      return {}
    }
    throw new Error('unexpected method')
  }
}
const unrelated = [old('analytics'), old('__Secure-next-auth.session-token.0', 'another-domain', 'example.com'),
  old('__Secure-next-auth.session-token.0', 'another-path', 'chatgpt.com', '/other'),
  old('__Secure-authjs.session-token.0'), old('__Secure-next-auth.session-token.0', 'subdomain-cookie', 'sub.chatgpt.com'),
  old('theme', 'ordinary-domain-cookie', '.chatgpt.com')]

async function rejectSafely(operation: Promise<void>, pattern: RegExp) {
  await assert.rejects(operation, error => { assert(error instanceof Error); assert.match(error.message, pattern); assert(!error.message.includes('secret-value-must-not-escape')); return true })
}
async function main() {
  const insecureOriginal = { ...old('non-secure-host'), secure: false }
  const mixed = new MockCdp([insecureOriginal])
  await applyChatGptCookies(mixed, [{ ...imported('non-secure-host'), secure: false }, imported('__Secure-next-auth.session-token')])
  assert.equal(mixed.jar.get(identity(insecureOriginal)).secure, false, 'ordinary non-Secure cookies must not roll back an otherwise valid login import')
  const mixedWrite = mixed.calls.find(call => call.method === 'Network.setCookies')!
  assert.equal(mixedWrite.params.cookies[0].url, 'http://chatgpt.com/')
  assert.equal(mixedWrite.params.cookies[1].url, 'https://chatgpt.com/')
  const farFuture = new MockCdp([])
  const started = Date.now() / 1000
  await applyChatGptCookies(farFuture, [{ ...imported('long-expiry'), expires: started + 1000 * 86400 }])
  const capped = farFuture.snapshot()[0].expires
  assert(capped >= started + 400 * 86400 && capped <= Date.now() / 1000 + 400 * 86400)
  const insecureRollback = new MockCdp([insecureOriginal])
  insecureRollback.failSetOnce = true
  await rejectSafely(applyChatGptCookies(insecureRollback, [{ ...imported('non-secure-host'), secure: false }]), /已恢复/)
  assert.deepEqual(insecureRollback.snapshot(), [insecureOriginal])

  const chunks = [old('__Secure-next-auth.session-token.0'), old('__Secure-next-auth.session-token.1'), old('theme', 'old-theme'),
    old('__Secure-next-auth.session-token.0', 'old-domain-chunk', '.chatgpt.com')]
  const ok = new MockCdp([...chunks, ...unrelated, old('sub-only', 'old-sub', 'sub.chatgpt.com', '/api')])
  await applyChatGptCookies(ok, [imported('__Secure-next-auth.session-token'), imported('theme'), imported('sub-only', 'new-sub', 'sub.chatgpt.com', '/api')])
  assert(!ok.jar.has(identity(chunks[0])) && !ok.jar.has(identity(chunks[1])), 'old auth shards are removed')
  assert(!ok.jar.has(identity(chunks[3])), 'stale domain-cookie shard on the same host is also removed')
  assert.equal(ok.jar.get(identity(old('__Secure-next-auth.session-token'))).value, 'new-synthetic')
  for (const cookie of unrelated) assert.deepEqual(ok.jar.get(identity(cookie)), cookie)
  assert.deepEqual(ok.calls[0].params.urls, ['https://chatgpt.com/', 'https://sub.chatgpt.com/api'])

  const toChunks = new MockCdp([old('__Secure-next-auth.session-token'), old('__Secure-next-auth.session-token.3')])
  await applyChatGptCookies(toChunks, [imported('__Secure-next-auth.session-token.0'), imported('__Secure-next-auth.session-token.1')])
  assert.equal(toChunks.jar.size, 2)
  assert(!toChunks.jar.has(identity(old('__Secure-next-auth.session-token'))))
  assert(!toChunks.jar.has(identity(old('__Secure-next-auth.session-token.3'))))
  const toDomain = new MockCdp([old('__Secure-next-auth.session-token.0'), old('__Secure-next-auth.session-token.1', 'wide', '.chatgpt.com')])
  await applyChatGptCookies(toDomain, [{ ...imported('__Secure-next-auth.session-token'), url: undefined, domain: '.chatgpt.com' }])
  assert.equal(toDomain.jar.size, 1, 'domain-cookie imports also replace same-host old host-only auth shards')
  assert.equal(toDomain.snapshot()[0].domain, '.chatgpt.com')

  const rollback = new MockCdp([...chunks, ...unrelated])
  const before = rollback.snapshot()
  rollback.failSetOnce = true
  await rejectSafely(applyChatGptCookies(rollback, [imported('__Secure-next-auth.session-token'), imported('theme'), imported('new-only')]), /已恢复/)
  assert.deepEqual(rollback.snapshot(), before, 'partial batch writes restore original values, host-only/domain scopes and attributes')
  const preserved = new MockCdp([old('__Host-fixture'), ...unrelated])
  preserved.failSetOnce = true
  await rejectSafely(applyChatGptCookies(preserved, [imported('__Host-fixture')]), /已恢复/)
  const restores = preserved.calls.filter(call => call.method === 'Network.setCookies').at(-1)!
  assert.equal(restores.params.cookies[0].domain, undefined)
  assert.equal(restores.params.cookies[0].url, 'https://chatgpt.com/')
  assert.equal(restores.params.cookies[0].expires, undefined)

  const deletedPartially = new MockCdp(chunks)
  const beforeDelete = deletedPartially.snapshot()
  deletedPartially.failDeleteAt = 2
  await rejectSafely(applyChatGptCookies(deletedPartially, [imported('__Secure-next-auth.session-token')]), /已恢复/)
  assert.deepEqual(deletedPartially.snapshot(), beforeDelete)

  const silentFailure = new MockCdp([old('theme')])
  silentFailure.skipSetOnce = true
  await rejectSafely(applyChatGptCookies(silentFailure, [imported('theme')]), /已恢复/)
  assert.equal(silentFailure.jar.get(identity(old('theme'))).value, 'old-synthetic')

  const disconnected = new MockCdp(chunks)
  disconnected.failSetOnce = true; disconnected.disconnectAfterSet = true
  await rejectSafely(applyChatGptCookies(disconnected, [imported('__Secure-next-auth.session-token')]), /未能全部恢复/)

  const noBackup = new MockCdp(chunks)
  noBackup.failRead = true
  await rejectSafely(applyChatGptCookies(noBackup, [imported('theme')]), /未进行导入/)
  assert.equal(noBackup.calls.length, 1)
  const partitioned = new MockCdp([{ ...old('theme'), partitionKey: { topLevelSite: 'https://chatgpt.com' } }])
  await rejectSafely(applyChatGptCookies(partitioned, [imported('theme')]), /未进行导入/)
  assert.equal(partitioned.calls.length, 1)
  for (const input of [[], [imported('theme', 'new', 'example.com')], [{ ...imported('theme'), path: '/ambiguous?path' }],
    [{ ...imported('theme'), path: '/ambiguous path' }], [{ ...imported('theme'), path: '/part/../other' }]]) {
    const bad = new MockCdp(chunks)
    await rejectSafely(applyChatGptCookies(bad, input), /内容无效/)
    assert.equal(bad.calls.length, 0)
  }
  console.log('chatgpt-cookie-session: exact scoped replacement, old auth chunks, partial-write rollback, host-only restoration, disconnect limits and redacted errors passed; mock CDP and synthetic values only')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
