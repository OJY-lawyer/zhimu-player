import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { registerAsrWorker } from './asrWorker'
import { registerChatGptEdgeWorker, shutdownChatGptBrowser } from './chatgptEdgeWorker'
import { MEDIA_SCHEME, registerMediaFileIpc, registerMediaProtocol } from './mediaFiles'
import { registerPlayerStateIpc, flushPendingPlayerStateWrites } from './playerStateStore'
import { registerApiGuide } from './apiGuide'
import { loadConfig, saveConfig, loadPresets, savePresets, saveGuideLanguage } from './configStore'
import { getAppLanguage, setAppLanguage, nativeText } from './locale'
import { pathToFileURL } from 'node:url'
import { registerWindowController, watchWindowState } from './windowController'
import { configureRuntimeIdentity } from './runtimeIdentity'
import { APP_DISPLAY_NAME } from '../shared/brand'
import { registerAppUpdates } from './appUpdates'

const DIST = path.join(__dirname, '../renderer')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null
let closeAllowed = false
let closing = false
let closeTimer: ReturnType<typeof setTimeout> | undefined
configureRuntimeIdentity(app)
if (!app.requestSingleInstanceLock()) app.exit(0)
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  // Windows can override the first ShowWindow with the launcher's SW_HIDE flag.
  // Retry once on the next event-loop turn if the actual window is still hidden.
  if (!mainWindow.isVisible()) {
    const window = mainWindow
    setImmediate(() => {
      if (window !== mainWindow || window.isDestroyed() || closing || window.isVisible()) return
      window.show()
      window.focus()
    })
  }
}
app.on('second-instance', showMainWindow)

function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false
  const url = event.senderFrame?.url?.split('#')[0]
  return url === (VITE_DEV_SERVER_URL || pathToFileURL(path.join(DIST, 'index.html')).href)
}
// All privileged IPC belongs to the packaged player, never login windows or child frames.
const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => originalHandle(channel, (event, ...args) => {
  if (!trusted(event)) throw new Error('Untrusted IPC sender')
  return listener(event, ...args)
})
const originalOn = ipcMain.on.bind(ipcMain)
ipcMain.on = (channel, listener) => originalOn(channel, (event, ...args) => { if (trusted(event)) listener(event, ...args) })


protocol.registerSchemesAsPrivileged([{
  scheme: MEDIA_SCHEME,
  privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true }
}])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    title: APP_DISPLAY_NAME,
    icon: path.join(__dirname, '../../assets/app-icon.png'),
    backgroundColor: '#12100f',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })

  // Show after loading even when an installer or launcher initially requested a hidden window.
  mainWindow.once('ready-to-show', showMainWindow)

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(DIST, 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const expected = VITE_DEV_SERVER_URL || pathToFileURL(path.join(DIST, 'index.html')).href
    if (url.split('#')[0] !== expected) event.preventDefault()
  })
  mainWindow.on('close', (event) => {
    if (closeAllowed) return
    event.preventDefault()
    if (closing) return
    closing = true
    mainWindow?.webContents.send('prepare-close')
    closeTimer = setTimeout(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      const answer = await dialog.showMessageBox(mainWindow, { type: 'warning', message: nativeText('保存尚未完成', 'Saving is not complete'), detail: nativeText('可以返回播放器稍后再试，或直接关闭（未保存的修改可能丢失）。', 'Return to the player and try again, or close now. Unsaved changes may be lost.'), buttons: [nativeText('返回播放器', 'Return to player'), nativeText('直接关闭', 'Close now')], defaultId: 0, cancelId: 0 })
      closing = false
      appUpdates.cancelPendingInstall()
      if (answer.response === 1) { closeAllowed = true; mainWindow.close() }
    }, 12000)
  })
  watchWindowState(mainWindow)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

registerWindowController(() => mainWindow)
registerMediaFileIpc(() => mainWindow)
registerPlayerStateIpc()
registerAsrWorker(() => mainWindow)
registerChatGptEdgeWorker(() => mainWindow)
registerApiGuide()
const appUpdates = registerAppUpdates(() => mainWindow)
ipcMain.handle('get-ui-language', () => getAppLanguage())
ipcMain.handle('set-ui-language', (_event, language) => setAppLanguage(language))
ipcMain.handle('save-guide-language', (_event, language) => saveGuideLanguage(language))
ipcMain.handle('complete-close', async (_event, saved: boolean) => {
  if (!closing) return
  if (closeTimer) clearTimeout(closeTimer)
  if (!saved) { closing = false; appUpdates.cancelPendingInstall(); return }
  try { await flushPendingPlayerStateWrites(); appUpdates.armInstallOnQuit(); closeAllowed = true; mainWindow?.close() }
  catch { closing = false; appUpdates.cancelPendingInstall(); throw new Error('保存播放状态失败。') }
})

app.whenReady().then(() => {
  registerMediaProtocol()
  createWindow()
})

app.on('window-all-closed', () => {
  void shutdownChatGptBrowser().finally(() => {
    if (!appUpdates.installAfterAllWindowsClosed()) app.quit()
  })
})

ipcMain.handle('open-file-dialog', async (_, options: { filters?: { name: string; extensions: string[] }[] }) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: options.filters
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('save-file', async (_, { defaultPath, content }: { defaultPath: string; content: string }) => {
  const result = await dialog.showSaveDialog(mainWindow!, { defaultPath })
  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, content, 'utf-8')
    return result.filePath
  }
  return null
})

ipcMain.handle('read-file', async (_, filePath: string) => {
  if (!fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath, 'utf-8')
})

ipcMain.handle('file-exists', async (_, filePath: string) => {
  return fs.existsSync(filePath)
})

ipcMain.handle('read-dir', async (_, dirPath: string) => {
  try {
    return fs.readdirSync(dirPath)
  } catch {
    return []
  }
})

ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8')
    return true
  } catch {
    return false
  }
})

ipcMain.handle('save-config', (_event, config) => saveConfig(config))
ipcMain.handle('load-config', () => loadConfig())
ipcMain.handle('save-presets', (_event, presets) => savePresets(presets))
ipcMain.handle('load-presets', () => loadPresets())

ipcMain.handle('save-recent-playlist', async (_, playlistPath: string) => {
  const recentPath = path.join(app.getPath('userData'), 'recent-playlist.json')
  fs.writeFileSync(recentPath, JSON.stringify({ path: playlistPath }), 'utf-8')
})

ipcMain.handle('load-recent-playlist', async () => {
  const recentPath = path.join(app.getPath('userData'), 'recent-playlist.json')
  if (fs.existsSync(recentPath)) {
    const content = fs.readFileSync(recentPath, 'utf-8')
    const data = JSON.parse(content)
    // 检查文件是否还存在
    if (data.path && fs.existsSync(data.path)) {
      return data.path
    }
  }
  return null
})

// 保存/加载应用设置（字幕大小等）
ipcMain.handle('save-settings', async (_, settings: { subtitleSize: number; subtitleOffset: number }) => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json')
  fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8')
})

ipcMain.handle('load-settings', async () => {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json')
  if (fs.existsSync(settingsPath)) {
    const content = fs.readFileSync(settingsPath, 'utf-8')
    return JSON.parse(content)
  }
  return null
})
