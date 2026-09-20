/* Real Edge CDP cookie contract, using synthetic values and a fresh isolated profile only. */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const Module = require('node:module')
const { spawn } = require('node:child_process')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const archive = path.resolve(process.env.ZHIMU_TEMP_ARCHIVE || path.join(require('node:os').tmpdir(), 'zhimu-cookie-cdp-tests'))
const output = path.resolve(process.env.ZHIMU_QA_OUTPUT || path.join(root, 'outputs/rc10-cookie-protocol'))
const executable = process.env.ZHIMU_COOKIE_TEST_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
function load(relative) {
  const filename = path.join(root, relative)
  const compiled = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, logLevel: 'silent' }).outputFiles[0].text
  const module = new Module(filename)
  module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename))
  module._compile(compiled, filename)
  return module.exports
}
const { applyChatGptCookies } = load('src/main/chatgptCookieSession.ts')
const { parseChatGptCookies } = load('src/main/chatgptCookies.ts')
const { connectEdge, parseEdgeEndpoint } = load('src/main/edgeCdp.ts')
const results = []
const cookie = (name, extra = {}) => ({ name, value: 'synthetic-value', url: 'https://chatgpt.com/', path: '/', secure: true, httpOnly: false, ...extra })
const publicCookie = ({ name, domain, path, secure, httpOnly, sameSite, expires, session }) => ({ name, domain, path, secure, httpOnly, sameSite, expires, session })

async function main() {
  await fs.mkdir(archive, { recursive: true }); await fs.mkdir(output, { recursive: true })
  const workspace = await fs.mkdtemp(path.join(archive, 'real-cdp-'))
  assert(path.dirname(workspace) === archive)
  const profile = path.join(workspace, 'profile')
  await fs.mkdir(profile)
  const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-extensions', '--host-resolver-rules=MAP * ~NOTFOUND', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let cdp, version, allPassed = false
  try {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      let endpoint
      try { endpoint = parseEdgeEndpoint(await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')) } catch {}
      if (endpoint) { try { cdp = await connectEdge(endpoint); break } catch {} }
      await sleep(100)
    }
    assert(cdp, 'isolated Edge connection did not start')
    version = await cdp.send('Browser.getVersion')
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const port = { send: (method, params) => cdp.send(method, params, sessionId) }
    await port.send('Network.enable')
    await port.send('Network.setBlockedURLs', { urls: ['*'] })
    const urls = ['https://chatgpt.com/', 'https://sub.chatgpt.com/api', 'https://example.com/']
    const read = async () => (await port.send('Network.getCookies', { urls })).cookies
    const future = Date.now() / 1000 + 86400 * 30
    const cases = [
      cookie('fixture-host-session'),
      cookie('fixture-domain-session', { url: undefined, domain: '.chatgpt.com' }),
      cookie('fixture-host-insecure', { secure: false }),
      cookie('fixture-domain-insecure', { url: undefined, domain: '.chatgpt.com', secure: false }),
      cookie('fixture-persistent', { expires: future }),
      cookie('fixture-far-future', { expires: future + 86400 * 500 }),
      cookie('fixture-strict', { sameSite: 'Strict' }),
      cookie('fixture-lax', { sameSite: 'Lax' }),
      cookie('fixture-none', { sameSite: 'None' }),
      cookie('__Host-fixture', { httpOnly: true }),
      cookie('fixture-path', { url: 'https://sub.chatgpt.com/', path: '/api', expires: future }),
      cookie('fixture-large-value', { value: 'x'.repeat(5000) }),
    ]
    for (const candidate of cases) {
      let error = null
      try { await applyChatGptCookies(port, [candidate]) } catch (failure) { error = failure.message }
      const stored = (await read()).find(item => item.name === candidate.name)
      const result = { name: candidate.name, applied: !error, error, expected: publicCookie(candidate), stored: stored ? publicCookie(stored) : null }
      // If the helper rejects, inspect the browser's direct contract using only this synthetic cookie.
      if (error) {
        try {
          await port.send('Network.setCookies', { cookies: [candidate] })
          const direct = (await read()).find(item => item.name === candidate.name)
          result.direct = direct ? publicCookie(direct) : null
        } catch { result.directWriteRejected = true }
      }
      results.push(result)
      if (candidate.name === 'fixture-large-value') assert(error, 'Chromium must reject the oversized synthetic cookie')
      else assert.equal(error, null, candidate.name + ' must import without rollback')
    }
    const old = [
      cookie('__Secure-next-auth.session-token.0', { value: 'old-host-chunk', httpOnly: true }),
      cookie('__Secure-next-auth.session-token.1', { value: 'old-domain-chunk', url: undefined, domain: '.chatgpt.com', httpOnly: true, sameSite: 'Lax', expires: future }),
      cookie('ordinary', { value: 'ordinary-host' }),
      cookie('ordinary', { value: 'ordinary-domain', url: undefined, domain: '.chatgpt.com' }),
      cookie('unrelated', { url: 'https://example.com/' }),
      cookie('old-insecure', { url: 'http://chatgpt.com/', secure: false, sourceScheme: 'Secure', sourcePort: 443, sameSite: 'Lax', expires: future }),
    ]
    await port.send('Network.setCookies', { cookies: old })
    await applyChatGptCookies(port, [cookie('__Secure-next-auth.session-token', { httpOnly: true }), cookie('ordinary'), cookie('mixed-insecure', { secure: false })])
    const replaced = await read()
    assert(!replaced.some(item => /session-token\.\d+$/.test(item.name)))
    assert(replaced.some(item => item.name === '__Secure-next-auth.session-token' && item.domain === 'chatgpt.com'))
    assert(replaced.some(item => item.name === 'ordinary' && item.domain === '.chatgpt.com' && item.value === 'ordinary-domain'))
    assert(replaced.some(item => item.name === 'unrelated' && item.domain === 'example.com'))
    assert(replaced.some(item => item.name === 'mixed-insecure' && item.secure === false))
    results.push({ name: 'auth-shard-replacement-and-unrelated-scopes', passed: true })
    await port.send('Network.setCookies', { cookies: old.slice(0, 2) })
    const stable = jar => jar.map(item => JSON.stringify([item.name, item.domain, item.path, item.value, item.secure, item.httpOnly, item.sameSite, item.session, item.expires, item.sourceScheme, item.sourcePort, item.priority])).sort()
    const before = stable(await read())
    let failed = false
    const failOnce = { async send(method, params) {
      if (method === 'Network.setCookies' && !failed) {
        failed = true
        await port.send(method, { cookies: params.cookies.slice(0, 1) })
        throw new Error('synthetic transport failure after partial write')
      }
      return port.send(method, params)
    } }
    await assert.rejects(applyChatGptCookies(failOnce, [cookie('__Secure-next-auth.session-token', { httpOnly: true }), cookie('old-insecure', { secure: false }), cookie('new-partial')]), /已恢复/)
    assert.deepEqual(stable(await read()), before)
    results.push({ name: 'real-partial-write-and-rollback', passed: true })
    const exported = [
      { domain: '.chatgpt.com', hostOnly: false, name: '__Secure-next-auth.session-token.0', value: 'synthetic-session-part-0', path: '/', secure: true, httpOnly: true, session: false, sameSite: 'lax', expirationDate: future },
      { domain: '.chatgpt.com', hostOnly: false, name: '__Secure-next-auth.session-token.1', value: 'synthetic-session-part-1', path: '/', secure: true, httpOnly: true, session: false, sameSite: 'lax', expirationDate: future },
      { domain: 'chatgpt.com', hostOnly: true, name: 'synthetic-ui-preference', value: 'compact', path: '/', secure: false, httpOnly: false, session: true, sameSite: 'unspecified' },
      { domain: '.chatgpt.com', hostOnly: false, name: 'synthetic-site-preference', value: 'en', path: '/', secure: false, httpOnly: false, session: false, sameSite: 'lax', expirationDate: future },
      { domain: 'chatgpt.com', hostOnly: true, name: '__Host-synthetic-csrf', value: 'synthetic-csrf', path: '/', secure: true, httpOnly: true, session: true, sameSite: 'lax' },
      { domain: 'chatgpt.com', hostOnly: true, name: 'synthetic-long-expiry', value: 'on', path: '/', secure: false, httpOnly: false, session: false, sameSite: 'strict', expirationDate: future + 86400 * 500 },
    ]
    const parsed = parseChatGptCookies(JSON.stringify(exported))
    assert.equal(parsed.length, exported.length)
    await applyChatGptCookies(port, parsed)
    const mixed = await read()
    assert.equal(mixed.filter(item => /^__Secure-next-auth\.session-token/.test(item.name)).length, 2)
    for (const item of exported) {
      const actual = mixed.find(candidate => candidate.name === item.name && candidate.domain === item.domain)
      assert(actual && actual.value === item.value && actual.secure === item.secure && actual.httpOnly === item.httpOnly && actual.session === item.session)
    }
    results.push({ name: 'cookie-editor-mixed-export-all-six-imported-auth-two-chunks', passed: true })
    allPassed = true
  } finally {
    await cdp?.close()
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)])
    if (child.exitCode === null) child.kill()
    await fs.writeFile(path.join(workspace, 'ORIGIN.json'), JSON.stringify({ createdFor: 'synthetic real CDP cookie diagnosis', originalPath: workspace, profile, preserved: true }, null, 2))
    const report = { createdAt: new Date().toISOString(), allPassed, version, profile, externalRequests: 'blocked; about:blank only', syntheticCookiesOnly: true, results }
    const reportFile = path.join(output, 'real-cookie-cdp-' + path.basename(workspace) + '.json')
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ reportFile, allPassed, cases: results.length,
      failed: results.filter(item => item.applied === false && item.name !== 'fixture-large-value').map(item => item.name) }, null, 2))
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
