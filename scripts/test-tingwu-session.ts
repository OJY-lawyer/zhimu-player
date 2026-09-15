import assert from 'node:assert/strict'
import Module from 'node:module'
import { EventEmitter } from 'node:events'

async function main(): Promise<void> {
  let authenticated = false
  let cleared = 0
  let cacheCleared = 0
  let partitionRequests = 0
  let userAgentSets = 0
  let loginMaterial = 'synthetic-persistent-login'
  const originalUserAgent = '知幕ZhimuPlayer/1.2.0-rc.4 Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Electron/44.3.0 Safari/537.36'
  let userAgent = originalUserAgent
  const operations: string[] = []
  const assertSafeUserAgent = () => {
    assert.equal(userAgentSets, 1, 'session user agent is configured once before use')
    assert.match(userAgent, /^[\x20-\x7e]+$/, 'HTTP header contains only printable ASCII')
    assert.equal(userAgent, originalUserAgent.replace('知幕', ''), 'retain the actual ASCII product and browser tokens')
    assert.match(userAgent, /Chrome\/152\.0\.0\.0/)
    assert.match(userAgent, /Electron\/44\.3\.0/)
  }
  let requestGuard: ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void) | undefined
  let permissionHandler: ((contents: unknown, permission: unknown, callback: (allowed: boolean) => void) => void) | undefined
  let permissionCheck: (() => boolean) | undefined
  const windows: FakeWindow[] = []
  type OpenResult = { action: string; outlivesOpener?: boolean; overrideBrowserWindowOptions?: any; createWindow?: (options: any) => unknown }
  class FakeWindow extends EventEmitter {
    destroyed = false
    urls: string[] = []
    contentsUserAgent = userAgent
    contentsUserAgentSets = 0
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: (handler: (details: { url: string }) => OpenResult) => { this.openHandler = handler },
      setUserAgent: (value: string) => { this.contentsUserAgent = value; this.contentsUserAgentSets++; operations.push('set-popup-user-agent') },
    })
    openHandler!: (details: { url: string }) => OpenResult
    constructor(public readonly options: any) { super(); assertSafeUserAgent(); operations.push('create-window'); windows.push(this) }
    isDestroyed() { return this.destroyed }
    close() { if (!this.destroyed) { this.destroyed = true; this.emit('closed') } }
    show() {}
    focus() {}
    async loadURL(url: string) { assertSafeUserAgent(); assert.match(this.contentsUserAgent, /^[\x20-\x7e]+$/); operations.push('load-url'); this.urls.push(url) }
  }
  const mockSession = {
    getUserAgent() { operations.push('get-user-agent'); return userAgent },
    setUserAgent(value: string) { userAgentSets++; userAgent = value; operations.push('set-user-agent') },
    setPermissionRequestHandler(handler: typeof permissionHandler) { permissionHandler = handler },
    setPermissionCheckHandler(handler: typeof permissionCheck) { permissionCheck = handler },
    on() {}, webRequest: { onBeforeRequest(handler: typeof requestGuard) { requestGuard = handler } },
    clearStorageData: async () => { cleared++; loginMaterial = ''; operations.push('clear-storage') },
    clearCache: async () => { cacheCleared++ }, cookies: { flushStore: async () => {} },
    fetch: async () => {
      assertSafeUserAgent()
      operations.push('probe-fetch')
      return authenticated
        ? { ok: true, status: 200, json: async () => ({ code: '0', data: { id: 'fixture-user' } }) }
        : { ok: false, status: 401, json: async () => ({}) }
    },
  }
  const loader = Module as unknown as { _load: (name: string, ...args: unknown[]) => unknown }
  const originalLoad = loader._load
  loader._load = function (name: string, ...args: unknown[]) {
    if (name === 'electron') return { BrowserWindow: FakeWindow, app: { getLocale: () => 'zh-CN', getPath: () => { throw new Error('No stored locale in this mock') } },
      session: { fromPartition: (partition: string) => { assert.equal(partition, 'persist:tingwu-player'); partitionRequests++; operations.push('get-tingwu-session'); return mockSession } } }
    return originalLoad.call(this, name, ...args)
  }
  try {
    const { openTingwuLogin, logoutTingwu, disposeTingwuSession, isTingwuLoginUrl, createTingwuClient } = await import('../src/main/tingwuSession')
    assert.equal(isTingwuLoginUrl('https://account.aliyun.com/login'), true)
    assert.equal(isTingwuLoginUrl('https://www.alipan.com/o/oauth/authorize'), true)
    for (const url of ['file:///C:/secret.txt', 'local-video://file/secret', 'https://aliyun.com.evil.com',
      'https://alipan.com.attacker.example/oauth', 'https://notalipan.com', 'https://alipan.com:8443/oauth',
      'https://user:password@aliyun.com', 'http://tingwu.aliyun.com', 'not-a-url']) assert.equal(isTingwuLoginUrl(url), false)
    assert.equal(userAgentSets, 0, 'module import must not change any session')
    assert.equal((await createTingwuClient().probe()).authenticated, false)
    assertSafeUserAgent()
    assert.equal(cleared, 0, 'sanitizing user agent must not clear login data')
    assert.equal(loginMaterial, 'synthetic-persistent-login')
    const pending = openTingwuLogin(null)
    assert.equal(openTingwuLogin(null), pending, 'reuse one login operation')
    const window = windows[0]
    const forbiddenPopupUrls = ['file:///C:/secret.txt', 'data:text/html,fixture', 'javascript:alert(1)',
      'local-video://file/secret', 'http://www.alipan.com/o/oauth/authorize', 'https://www.alipan.com.attacker.example/oauth',
      'https://attacker.example', 'https://user:password@www.alipan.com/oauth', 'https://www.alipan.com:8443/oauth']
    const assertGuards = (current: FakeWindow, popup: boolean) => {
      for (const url of forbiddenPopupUrls) {
        assert.deepEqual(current.openHandler({ url }), { action: 'deny' })
        for (const eventName of ['will-navigate', 'will-redirect']) {
          let prevented = false
          current.webContents.emit(eventName, { preventDefault: () => { prevented = true } }, url)
          assert.equal(prevented, true, `${eventName} rejects ${url}`)
        }
      }
      for (const eventName of ['will-navigate', 'will-redirect']) {
        let prevented = false
        current.webContents.emit(eventName, { preventDefault: () => { prevented = true } }, 'https://www.alipan.com/o/oauth/authorize')
        assert.equal(prevented, false)
        current.webContents.emit(eventName, { preventDefault: () => { prevented = true } }, 'about:blank')
        assert.equal(prevented, !popup)
      }
    }
    const createPopup = (opener: FakeWindow, url: string, loginParent: FakeWindow) => {
      const oldUrls = [...opener.urls]
      const decision = opener.openHandler({ url })
      assert.equal(decision.action, 'allow')
      assert.equal(decision.outlivesOpener, false)
      const options = decision.overrideBrowserWindowOptions
      assert.equal(options.parent, loginParent)
      assert.equal(options.webPreferences.session, mockSession)
      assert.equal(options.webPreferences.preload, undefined)
      assert.equal(options.webPreferences.nodeIntegration, false)
      assert.equal(options.webPreferences.contextIsolation, true)
      assert.equal(options.webPreferences.sandbox, true)
      assert.equal(options.webPreferences.webSecurity, true)
      assert.equal(options.webPreferences.allowRunningInsecureContent, false)
      assert.deepEqual(opener.urls, oldUrls, 'opening OAuth must not navigate the original login window')
      assert.equal(typeof decision.createWindow, 'function', 'custom creation sets UA before native popup navigation')
      const contents = decision.createWindow!(options)
      const child = windows[windows.length - 1]
      assert.equal(contents, child.webContents)
      assert.equal(child.contentsUserAgentSets, 1)
      assert.equal(child.contentsUserAgent, userAgent)
      void child.loadURL(url)
      assertGuards(child, true)
      return child
    }
    assert.equal(window.options.webPreferences.preload, undefined)
    assert.equal(window.options.webPreferences.nodeIntegration, false)
    assert.equal(window.options.webPreferences.sandbox, true)
    assert.equal(window.options.webPreferences.contextIsolation, true)
    assert.equal(window.options.webPreferences.webSecurity, true)
    assert.equal(window.options.webPreferences.session, mockSession)
    assert.equal(permissionCheck?.(), false)
    permissionHandler?.(null, 'media', allowed => assert.equal(allowed, false))
    for (const url of ['file:///C:/secret.txt', 'local-video://file/secret', 'http://example.com', 'invalid']) {
      requestGuard?.({ url }, result => assert.equal(result.cancel, true))
    }
    requestGuard?.({ url: 'https://tingwu.aliyun.com/api' }, result => assert.equal(result.cancel, false))
    let navigationPrevented = false
    window.webContents.emit('will-navigate', { preventDefault: () => { navigationPrevented = true } }, 'file:///C:/secret.txt')
    assert.equal(navigationPrevented, true)
    assert.deepEqual(window.openHandler({ url: 'https://example.com' }), { action: 'deny' })
    assert.equal(window.urls.length, 1)
    assertGuards(window, false)
    const oauth = createPopup(window, 'https://www.alipan.com/o/oauth/authorize', window)
    const blank = createPopup(oauth, 'about:blank', window)
    const nested = createPopup(blank, 'https://account.aliyun.com/login', window)
    blank.close()
    assert.equal(window.destroyed, false, 'closing an OAuth child does not close the parent login')
    assert.equal(openTingwuLogin(null), pending, 'closing a child keeps the original login pending')
    authenticated = true
    oauth.webContents.emit('did-finish-load')
    assert.equal((await pending).authenticated, true)
    assert.equal(window.destroyed, true)
    assert.equal(oauth.destroyed, true, 'successful login closes OAuth windows')
    assert.equal(nested.destroyed, true, 'successful login closes nested OAuth windows')
    assert.deepEqual(oauth.openHandler({ url: 'https://www.alipan.com/o/oauth/authorize' }), { action: 'deny' })
    assert.equal(cleared, 0)
    assert.equal(cacheCleared, 0)
    assert.equal(loginMaterial, 'synthetic-persistent-login')
    authenticated = false
    const second = openTingwuLogin(null)
    const secondWindow = windows[windows.length - 1]
    const cancelledPopup = createPopup(secondWindow, 'about:blank', secondWindow)
    secondWindow.close()
    assert.equal((await second).authenticated, false)
    assert.equal(cancelledPopup.destroyed, true, 'cancelling the main login closes its children')
    assert.equal(partitionRequests, 1, 'reopening login reuses the same persistent session')
    assert.equal(userAgentSets, 1)
    assert.equal(cleared, 0, 'closing a login window must not log out')
    assert.equal(loginMaterial, 'synthetic-persistent-login')
    const third = openTingwuLogin(null)
    const thirdWindow = windows[windows.length - 1]
    const logoutPopup = createPopup(thirdWindow, 'https://www.alipan.com/o/oauth/authorize', thirdWindow)
    assert.equal((await logoutTingwu()).authenticated, false)
    assert.equal((await third).authenticated, false)
    assert.equal(logoutPopup.destroyed, true, 'explicit logout closes OAuth children')
    assert.equal(cleared, 1)
    assert.equal(cacheCleared, 1)
    assert.equal(loginMaterial, '')
    for (const operation of ['probe-fetch', 'create-window', 'load-url']) {
      assert(operations.indexOf('set-user-agent') < operations.indexOf(operation), `ASCII user agent is set before first ${operation}`)
    }
    assert.equal(partitionRequests, 1)
    assert.equal(userAgentSets, 1)
    disposeTingwuSession()
    console.log('tingwu-session: ASCII UA, isolated secure OAuth/nested popups, allowed-domain guards, child lifecycle, session/cookie preservation and explicit logout passed (offline fixtures)')
  } finally { loader._load = originalLoad }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
