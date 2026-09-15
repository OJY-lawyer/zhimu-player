import { BrowserWindow, session, type Session } from 'electron'
import { TingwuClient, type TingwuAuthResult } from './tingwuClient'
import { nativeText } from './locale'

const PARTITION = 'persist:tingwu-player'
const HOME = 'https://tingwu.aliyun.com/home'
let browserSession: Session | undefined
let loginWindow: BrowserWindow | null = null
let loginPromise: Promise<TingwuAuthResult> | null = null
let cancelLogin: (() => void) | undefined

export function isTingwuLoginUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['aliyun.com', 'alibaba.com', 'taobao.com', 'alipay.com', 'dingtalk.com', 'alipan.com']
        .some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch { return false }
}

function getSession(): Session {
  if (!browserSession) {
    browserSession = session.fromPartition(PARTITION)
    // Electron adds the product name to its UA. Keep the real browser/version
    // tokens, but remove non-ASCII characters rejected by Aliyun's login gateway.
    // Set this before any request or WebContents; never replace or clear the partition.
    browserSession.setUserAgent(browserSession.getUserAgent().replace(/[^\x20-\x7e]/g, ''))
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    browserSession.setPermissionCheckHandler(() => false)
    browserSession.on('will-download', event => event.preventDefault())
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      // Remote pages never load local files or application protocols.
      try {
        const protocol = new URL(details.url).protocol
        callback({ cancel: !['https:', 'wss:', 'data:', 'blob:', 'about:'].includes(protocol) })
      } catch { callback({ cancel: true }) }
    })
  }
  return browserSession
}

export function createTingwuClient(): TingwuClient {
  const clientSession = getSession()
  return new TingwuClient((url, options) => clientSession.fetch(url, options))
}

export function openTingwuLogin(parent: BrowserWindow | null): Promise<TingwuAuthResult> {
  if (loginPromise) { loginWindow?.show(); loginWindow?.focus(); return loginPromise }
  const client = createTingwuClient()
  loginPromise = new Promise<TingwuAuthResult>(resolve => {
    let finished = false
    let probing = false
    const controller = new AbortController()
    const popups = new Set<BrowserWindow>()
    const webPreferences: Electron.WebPreferences = {
      session: getSession(), nodeIntegration: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      // No preload: neither the login page nor its OAuth popups receive file IPC.
    }
    const window = new BrowserWindow({
      width: 1060, height: 780, minWidth: 800, minHeight: 600, show: true,
      title: nativeText('登录通义听悟 · 知幕', 'Sign in to Tingwu · Zhimu Player'), autoHideMenuBar: true,
      ...(parent ? { parent } : {}),
      webPreferences,
    })
    // window.open uses the opener WebContents UA, which can otherwise still
    // contain the application's fallback even when its Session was configured.
    window.webContents.setUserAgent(getSession().getUserAgent())
    loginWindow = window
    const finish = (result: TingwuAuthResult) => {
      if (finished) return
      finished = true
      clearInterval(interval)
      clearTimeout(timeout)
      controller.abort()
      cancelLogin = undefined
      loginWindow = null
      for (const popup of popups) if (!popup.isDestroyed()) popup.close()
      if (!window.isDestroyed()) window.close()
      resolve(result)
    }
    const probe = async () => {
      if (finished || probing) return
      probing = true
      try {
        const result = await client.probe(controller.signal)
        if (!finished && result.authenticated) {
          await getSession().cookies.flushStore()
          finish(result)
        }
      } catch {
        // Keep the login page open so a transient persistence error can be retried.
      } finally { probing = false }
    }
    const interval = setInterval(() => { void probe() }, 3_000)
    const timeout = setTimeout(() => finish({ success: false, authenticated: false,
      message: '登录等待已结束；点击“登录听悟”可重新打开。' }), 10 * 60_000)
    cancelLogin = () => finish({ success: false, authenticated: false, message: '已关闭听悟登录窗口。' })
    window.on('closed', () => finish({ success: false, authenticated: false,
      message: '登录窗口已关闭；完成登录后可重新检测。' }))
    const protectWindow = (current: BrowserWindow, isPopup = false) => {
      const allowedNavigation = (url: string) => isTingwuLoginUrl(url) || (isPopup && url === 'about:blank')
      current.webContents.on('will-navigate', (event, url) => { if (!allowedNavigation(url)) event.preventDefault() })
      current.webContents.on('will-redirect', (event, url) => { if (!allowedNavigation(url)) event.preventDefault() })
      current.webContents.setWindowOpenHandler(({ url }) => {
        if (finished || (url !== 'about:blank' && !isTingwuLoginUrl(url))) return { action: 'deny' }
        // Let Electron create the actual window so window.opener and OAuth
        // callbacks keep working. Reusing the original window breaks that flow.
        return { action: 'allow', outlivesOpener: false,
          overrideBrowserWindowOptions: {
            width: 600, height: 760, minWidth: 480, minHeight: 600, show: true,
            parent: window, autoHideMenuBar: true, webPreferences,
          },
          createWindow: options => {
            // Native window.open can inherit the application's fallback UA even
            // with the same Session. Override it before the new page navigates.
            const popup = new BrowserWindow(options)
            const contents = popup.webContents
            contents.setUserAgent(getSession().getUserAgent())
            if (finished) { popup.close(); return contents }
            popups.add(popup)
            popup.once('closed', () => popups.delete(popup))
            protectWindow(popup, true)
            contents.on('did-finish-load', () => { void probe() })
            return contents
          },
        }
      })
    }
    protectWindow(window)
    window.webContents.on('did-finish-load', () => { void probe() })
    void window.loadURL(HOME).catch(() => finish({ success: false, authenticated: false,
      message: '听悟登录页未能打开，请检查网络后重试。' }))
  }).finally(() => { loginPromise = null })
  return loginPromise
}

export async function logoutTingwu(): Promise<TingwuAuthResult> {
  cancelLogin?.()
  const currentSession = getSession()
  await currentSession.clearStorageData()
  await currentSession.clearCache()
  await currentSession.cookies.flushStore()
  return { success: true, authenticated: false, message: '已清除本播放器的听悟登录状态；云端任务仍保留。' }
}

export function disposeTingwuSession(): void { cancelLogin?.() }
