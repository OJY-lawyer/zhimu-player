import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AIConfig,
  AsrProgress,
  ChatGptGuideProgress,
  ChatGptGuideRequest,
  ElectronAPI,
  PlayerState,
  Preset,
  WindowState
} from '../shared/contracts'

const electronAPI: ElectronAPI = {
  getAppUpdateState: () => ipcRenderer.invoke('app-update-get-state'),
  checkAppUpdates: () => ipcRenderer.invoke('app-update-check'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-update-download'),
  installAppUpdate: () => ipcRenderer.invoke('app-update-install'),
  onAppUpdateState: (listener) => {
    const subscription = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
    ipcRenderer.on('app-update-state', subscription)
    return () => ipcRenderer.removeListener('app-update-state', subscription)
  },
  getUiLanguage: () => ipcRenderer.invoke('get-ui-language'),
  setUiLanguage: (language) => ipcRenderer.invoke('set-ui-language', language),
  saveGuideLanguage: (language) => ipcRenderer.invoke('save-guide-language', language),
  onPrepareClose: (listener) => { ipcRenderer.on('prepare-close', listener); return () => ipcRenderer.removeListener('prepare-close', listener) },
  completeClose: (saved) => ipcRenderer.invoke('complete-close', saved),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  probeAsr: () => ipcRenderer.invoke('asr-probe'),
  loginAsr: () => ipcRenderer.invoke('asr-login'),
  logoutAsr: () => ipcRenderer.invoke('asr-logout'),
  loginChatGpt: () => ipcRenderer.invoke('chatgpt-login'),
  logoutChatGpt: () => ipcRenderer.invoke('chatgpt-logout'),
  requestApiGuide: (messages) => ipcRenderer.invoke('api-guide', messages),
  listApiModels: (request) => ipcRenderer.invoke('api-models', request),
  cancelApiGuide: () => ipcRenderer.invoke('api-cancel'),
  openFileDialog: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('open-file-dialog', options || {}),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  saveFile: (options: { defaultPath: string; content: string }) =>
    ipcRenderer.invoke('save-file', options),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  fileExists: (filePath: string) => ipcRenderer.invoke('file-exists', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('read-dir', dirPath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('write-file', filePath, content),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  selectVideoFolder: () => ipcRenderer.invoke('select-video-folder'),
  scanVideoDirectory: (folderPath: string) =>
    ipcRenderer.invoke('scan-video-directory', folderPath),
  resolveMediaFile: (filePath: string) => ipcRenderer.invoke('resolve-media-file', filePath),
  resolveDroppedMedia: (droppedPath: string) =>
    ipcRenderer.invoke('resolve-dropped-media', droppedPath),
  startAsrTranscription: (videoPaths, language) =>
    ipcRenderer.invoke('asr-start', videoPaths, language),
  cancelAsrTranscription: () => ipcRenderer.invoke('asr-cancel'),
  onAsrProgress: (listener: (progress: AsrProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: AsrProgress) => listener(progress)
    ipcRenderer.on('asr-progress', subscription)
    return () => ipcRenderer.removeListener('asr-progress', subscription)
  },
  importChatGptCookies: () => ipcRenderer.invoke('chatgpt-import-cookies'),
  probeChatGpt: () => ipcRenderer.invoke('chatgpt-probe'),
  generateChatGptGuide: (request: ChatGptGuideRequest) =>
    ipcRenderer.invoke('chatgpt-generate-guide', request),
  cancelChatGptGuide: () => ipcRenderer.invoke('chatgpt-cancel-guide'),
  onChatGptGuideProgress: (listener: (progress: ChatGptGuideProgress) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: ChatGptGuideProgress) => listener(progress)
    ipcRenderer.on('chatgpt-guide-progress', subscription)
    return () => ipcRenderer.removeListener('chatgpt-guide-progress', subscription)
  },
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  getWindowState: () => ipcRenderer.invoke('window-get-state'),
  setFullscreen: (enabled: boolean) => ipcRenderer.invoke('window-set-fullscreen', enabled),
  toggleFullscreen: () => ipcRenderer.invoke('window-toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('window-exit-fullscreen'),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('window-set-always-on-top', enabled),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window-toggle-always-on-top'),
  onWindowStateChanged: (listener: (state: WindowState) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, state: WindowState) => listener(state)
    ipcRenderer.on('window-state-changed', subscription)
    return () => ipcRenderer.removeListener('window-state-changed', subscription)
  },
  loadPlayerState: () => ipcRenderer.invoke('load-player-state'),
  savePlayerState: (state: PlayerState) => ipcRenderer.invoke('save-player-state', state),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config: AIConfig) =>
    ipcRenderer.invoke('save-config', config),
  savePresets: (presets: Preset[]) =>
    ipcRenderer.invoke('save-presets', presets),
  loadPresets: () => ipcRenderer.invoke('load-presets'),
  saveRecentPlaylist: (path: string) => ipcRenderer.invoke('save-recent-playlist', path),
  loadRecentPlaylist: () => ipcRenderer.invoke('load-recent-playlist'),
  saveSettings: (settings: { subtitleSize: number; subtitleOffset: number }) =>
    ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
