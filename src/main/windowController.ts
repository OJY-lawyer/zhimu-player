import { BrowserWindow, ipcMain } from 'electron'
import type { WindowState } from '../shared/contracts'

type WindowProvider = () => BrowserWindow | null

function requireWindow(getWindow: WindowProvider): BrowserWindow {
  const window = getWindow()
  if (!window || window.isDestroyed()) {
    throw new Error('播放器窗口当前不可用')
  }
  return window
}

export function getWindowState(window: BrowserWindow): WindowState {
  return {
    isFullscreen: window.isFullScreen(),
    isMaximized: window.isMaximized(),
    isAlwaysOnTop: window.isAlwaysOnTop()
  }
}

function publishWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('window-state-changed', getWindowState(window))
  }
}

export function watchWindowState(window: BrowserWindow): void {
  const publish = () => publishWindowState(window)

  window.on('enter-full-screen', publish)
  window.on('leave-full-screen', publish)
  window.on('maximize', publish)
  window.on('unmaximize', publish)
  window.on('always-on-top-changed', publish)
  window.webContents.on('did-finish-load', publish)
}

export function registerWindowController(getWindow: WindowProvider): void {
  ipcMain.on('window-minimize', () => getWindow()?.minimize())
  ipcMain.on('window-maximize', () => {
    const window = getWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('window-close', () => getWindow()?.close())

  ipcMain.handle('window-get-state', () => getWindowState(requireWindow(getWindow)))

  ipcMain.handle('window-set-fullscreen', (_event, enabled: boolean) => {
    const window = requireWindow(getWindow)
    window.setFullScreen(enabled)
    return getWindowState(window)
  })

  ipcMain.handle('window-toggle-fullscreen', () => {
    const window = requireWindow(getWindow)
    window.setFullScreen(!window.isFullScreen())
    return getWindowState(window)
  })

  ipcMain.handle('window-exit-fullscreen', () => {
    const window = requireWindow(getWindow)
    window.setFullScreen(false)
    return getWindowState(window)
  })

  ipcMain.handle('window-set-always-on-top', (_event, enabled: boolean) => {
    const window = requireWindow(getWindow)
    window.setAlwaysOnTop(enabled)
    return getWindowState(window)
  })

  ipcMain.handle('window-toggle-always-on-top', () => {
    const window = requireWindow(getWindow)
    window.setAlwaysOnTop(!window.isAlwaysOnTop())
    return getWindowState(window)
  })
}
