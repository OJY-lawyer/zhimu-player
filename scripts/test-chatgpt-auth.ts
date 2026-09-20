import assert from 'node:assert/strict'
import vm from 'node:vm'
import { chatGptPageProbeExpression } from '../src/main/chatgptAuth'

type Fixture = {
  status?: number
  json?: unknown
  fetchError?: boolean
  jsonError?: boolean
  stall?: 'fetch' | 'json'
  login?: boolean
  hiddenLogin?: boolean
  readyState?: string
  challenge?: boolean
  prompt?: boolean
  text?: string
  href?: string
  projectName?: string
}
async function check(fixture: Fixture) {
  let calls = 0
  let signal: AbortSignal | undefined
  let timeoutMs = 0
  const timers = new Map<number, () => void>()
  const login = { textContent: 'Log in', hidden: !!fixture.hiddenLogin, getAttribute: () => null,
    getClientRects: () => fixture.hiddenLogin ? [] : [{}] }
  const context = {
    document: { title: fixture.challenge ? 'Just a moment…' : 'ChatGPT', body: { innerText: fixture.text || 'Fixture project' },
      readyState: fixture.readyState || 'complete',
      querySelector: (selector: string) => selector.includes('prompt-textarea') ? fixture.prompt ? {} : null : fixture.challenge ? {} : null,
      querySelectorAll: () => fixture.login ? [login] : [] },
    location: { href: fixture.href || 'https://chatgpt.com/?sensitive=fixture#private-fragment' },
    URL, AbortController, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: (callback: () => void, ms: number) => { timeoutMs = ms; timers.set(1, callback); return 1 },
    clearTimeout: (id: number) => { timers.delete(id) },
    fetch: async (url: string, options: RequestInit) => {
      calls++
      assert.equal(url, '/api/auth/session')
      assert.equal(options.credentials, 'include')
      assert.equal(options.redirect, 'error')
      signal = options.signal as AbortSignal
      if (fixture.fetchError) throw new Error('sensitive synthetic request failure')
      if (fixture.stall === 'fetch') return new Promise(() => {})
      const status = fixture.status ?? 200
      return { status, ok: status >= 200 && status < 300, json: async () => {
        if (fixture.jsonError) throw new Error('sensitive synthetic response body')
        if (fixture.stall === 'json') return new Promise(() => {})
        return fixture.json ?? {}
      } }
    },
  }
  const resultPromise = vm.runInNewContext(chatGptPageProbeExpression(fixture.projectName ?? 'Fixture project'), context)
  if (fixture.stall) {
    await new Promise<void>(resolve => setImmediate(resolve))
    assert(timeoutMs > 0 && timeoutMs < 20_000, 'page deadline must be below the CDP command deadline')
    timers.get(1)!()
  }
  const result = await resultPromise
  assert.equal(timers.size, 0)
  if (calls) assert.equal(signal?.aborted, true, 'request is cleaned up after evaluation')
  assert(!JSON.stringify(result).includes('fixture-token-secret'))
  assert(!JSON.stringify(result).includes('fixture-user-private'))
  assert(!JSON.stringify(result).includes('sensitive'))
  assert(!result.currentUrl.includes('?') && !result.currentUrl.includes('#'))
  assert.deepEqual(Object.keys(result).sort(), ['authStatus', 'authenticated', 'blocked', 'currentUrl', 'message', 'projectVisible', 'success'])
  return { result, calls }
}

async function main() {
  const yes = (await check({ json: { user: { id: 'fixture-user-private' }, accessToken: 'fixture-token-secret' } })).result
  assert.equal(yes.authStatus, 'authenticated')
  assert.equal(yes.success, true)
  assert.equal(yes.authenticated, true)
  assert.equal(yes.projectVisible, true)
  const no = (await check({ status: 401 })).result
  assert.equal(no.authStatus, 'signed-out')
  assert.equal(no.authenticated, false)
  const denied = (await check({ status: 403 })).result
  assert.equal(denied.authStatus, 'unknown')
  assert.equal(denied.blocked, true, 'website refusal stops repeated background probes')
  assert.match(denied.message, /403/)
  assert.match(denied.message, /登录资料已保留/)
  for (const fixture of [{ status: 503 }, { status: 429 }, { status: 403 }, { fetchError: true }, { jsonError: true },
    { json: {} }, { json: {}, login: true, hiddenLogin: true }, { json: [], login: true },
    { json: { error: 'fixture-user-private' }, login: true }, { json: { user: {} }, login: true }]) {
    const { result } = await check(fixture)
    assert.equal(result.authStatus, 'unknown')
    assert.equal(result.authenticated, false)
    assert(!/过期|尚未登录/.test(result.message), 'transient/ambiguous failures must not tell the user they were logged out')
  }
  for (const json of [{}, { user: null }, { expires: '2026-09-20T00:00:00Z' }]) {
    assert.equal((await check({ json, login: true })).result.authStatus, 'signed-out')
  }
  const loading = await check({ readyState: 'loading', status: 401, login: true })
  assert.equal(loading.result.authStatus, 'unknown')
  assert.equal(loading.calls, 0)
  const challenge = await check({ challenge: true, json: { user: { id: 'fixture-user-private' } } })
  assert.equal(challenge.result.authStatus, 'unknown')
  assert.equal(challenge.result.blocked, true)
  assert.equal(challenge.calls, 0, 'human verification is not bypassed')
  const ordinaryCloudflareText = await check({ prompt: true, text: 'Explain Cloudflare and verify you are human messages', json: { user: { id: 'fixture-user-private' } } })
  assert.equal(ordinaryCloudflareText.result.authStatus, 'authenticated')
  for (const stall of ['fetch', 'json'] as const) {
    const timeout = (await check({ stall })).result
    assert.equal(timeout.authStatus, 'unknown')
    assert.match(timeout.message, /超时/)
  }
  const otherOrigin = await check({ href: 'https://example.com/page?fixture=private', status: 401 })
  assert.equal(otherOrigin.calls, 0)
  assert.equal(otherOrigin.result.authStatus, 'unknown')
  const quotedProject = 'Fixture "; globalThis.injected = true; // project'
  assert.equal((await check({ projectName: quotedProject, text: quotedProject, json: { user: { id: 'fixture-user-private' } } })).result.projectVisible, true)
  assert.equal((await check({ projectName: '', json: {} })).result.projectVisible, false)
  console.log('chatgpt-auth: tri-state auth, bounded fetch/body timeout, safe errors/URLs, challenge handling and redaction passed; no real ChatGPT requests')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
