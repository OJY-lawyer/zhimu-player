import type { AppLanguage, AsrLanguage, GuideLanguage } from './language'
import type { AppUpdateAPI } from './updateTypes'

export const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'webm', 'mov', 'm4v', 'ts'] as const

export type VideoExtension = (typeof VIDEO_EXTENSIONS)[number]

export interface MediaFile {
  path: string
  url: string
  name: string
  stem: string
  extension: VideoExtension
}

export interface MediaFolderSelection {
  folderPath: string
  folderName: string
  files: MediaFile[]
}

export interface MediaDropSelection {
  sourceKind: 'folder' | 'single-video'
  sourcePath: string
  displayName: string
  files: MediaFile[]
}

export interface WindowState {
  isFullscreen: boolean
  isMaximized: boolean
  isAlwaysOnTop: boolean
}

export interface AsrProgress {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  message: string
  percent?: number
}

export interface AsrRunResult {
  success: boolean
  message: string
  missingOutputs?: string[]
  cancelled?: boolean
}

export interface ChatGptProbeResult {
  success: boolean
  authenticated: boolean
  authStatus?: 'authenticated' | 'signed-out' | 'unknown'
  projectVisible: boolean
  blocked?: boolean
  currentUrl?: string
  message: string
}

export interface ConnectionResult { success: boolean; authenticated: boolean; message: string }
export type ChatGptTier = 'plus' | 'pro'

/** Names from the ChatGPT website; these are not OpenAI API model identifiers. */
export interface ChatGptWebSelection {
  model: string
  reasoning: string | null
}

export interface ChatGptWebModelOption {
  model: string
  reasoningOptions: string[]
}

export interface ChatGptModelsResult {
  success: boolean
  models: ChatGptWebModelOption[]
  message: string
}

export type GuideProvider = 'chatgpt-web' | 'compatible-api'

export interface ChatGptGuideRequest {
  taskMarkdown: string
  playlistName: string
  tier?: ChatGptTier
  selection?: ChatGptWebSelection
  projectName?: string
}

export interface ChatGptGuideResult {
  success: boolean
  message: string
  content?: string
  cancelled?: boolean
}

export interface ChatGptGuideProgress {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: 'preparing' | 'opening-project' | 'selecting-model' | 'uploading' | 'waiting' | 'completed'
  message: string
  attempt?: number
}

export type DrawerTab = 'playlist' | 'subtitles' | 'guide'

export interface PersistedVideoState {
  videoPath: string
  subtitlePath?: string
  order: number
  lastPosition: number
  duration: number
  subtitleOffset: number
  completed: boolean
  completionSuppressed?: boolean
  isNew: boolean
}

export interface PersistedPlaylistState {
  id: string
  sourcePath: string
  sourceKind: 'folder' | 'single-video'
  displayName: string
  activeVideoPath: string | null
  activeDrawerTab: DrawerTab
  activeGuidePath?: string
  playbackRate: number
  videos: PersistedVideoState[]
}

export interface PlayerState {
  version: 1
  activePlaylistId: string | null
  volume: number
  muted: boolean
  autoplayNext: boolean
  alwaysOnTop: boolean
  drawer: {
    pinned: boolean
    width: number
  }
  subtitleStyle: {
    visible: boolean
    size: number
    verticalPosition: number
    backgroundOpacity: number
  }
  playlists: Record<string, PersistedPlaylistState>
  updatedAt: string
}

export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
  provider?: GuideProvider
  chatGptTier?: ChatGptTier
  chatGptSelection?: ChatGptWebSelection | null
  chatGptProject?: string
  hasApiKey?: boolean
  clearApiKey?: boolean
  setupCompleted?: boolean
  guideLanguage?: GuideLanguage
  asrLanguage?: AsrLanguage
}

export interface ApiModelsRequest {
  baseUrl: string
  apiKey: string
  clearApiKey?: boolean
}

export interface ApiModelsResult {
  models: string[]
  source: 'live' | 'cache' | 'none'
  fetchedAt?: string
  error?: 'credentials' | 'invalid-url' | 'unauthorized' | 'unavailable' | 'invalid-response' | 'timeout'
}

export interface Preset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface ElectronAPI extends AppUpdateAPI {
  getUiLanguage: () => Promise<AppLanguage>
  setUiLanguage: (language: AppLanguage) => Promise<void>
  saveGuideLanguage: (language: GuideLanguage) => Promise<void>
  onPrepareClose: (listener: () => void) => () => void
  completeClose: (saved: boolean) => Promise<void>
  getPathForFile: (file: File) => string
  probeAsr: () => Promise<ConnectionResult>
  loginAsr: () => Promise<ConnectionResult>
  logoutAsr: () => Promise<ConnectionResult>
  loginChatGpt: () => Promise<ChatGptProbeResult>
  logoutChatGpt: () => Promise<ChatGptProbeResult>
  requestApiGuide: (messages: {role: 'user' | 'assistant'; content: string}[]) => Promise<ChatGptGuideResult>
  listApiModels: (request: ApiModelsRequest) => Promise<ApiModelsResult>
  cancelApiGuide: () => Promise<boolean>
  openFileDialog: (options?: {
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<string | null>
  openFolderDialog: () => Promise<string | null>
  saveFile: (options: { defaultPath: string; content: string }) => Promise<string | null>
  readFile: (filePath: string) => Promise<string | null>
  fileExists: (filePath: string) => Promise<boolean>
  readDir: (dirPath: string) => Promise<string[]>
  writeFile: (filePath: string, content: string) => Promise<boolean>

  selectVideoFile: () => Promise<MediaFile | null>
  selectVideoFolder: () => Promise<MediaFolderSelection | null>
  scanVideoDirectory: (folderPath: string) => Promise<MediaFile[]>
  resolveMediaFile: (filePath: string) => Promise<MediaFile | null>
  resolveDroppedMedia: (droppedPath: string) => Promise<MediaDropSelection | null>

  startAsrTranscription: (videoPaths: string[], language?: AsrLanguage) => Promise<AsrRunResult>
  cancelAsrTranscription: () => Promise<boolean>
  onAsrProgress: (listener: (progress: AsrProgress) => void) => () => void

  importChatGptCookies: (source?: 'clipboard' | 'file' | 'paste', text?: string) => Promise<ChatGptProbeResult>
  probeChatGpt: () => Promise<ChatGptProbeResult>
  listChatGptModels: () => Promise<ChatGptModelsResult>
  generateChatGptGuide: (request: ChatGptGuideRequest) => Promise<ChatGptGuideResult>
  cancelChatGptGuide: () => Promise<boolean>
  onChatGptGuideProgress: (listener: (progress: ChatGptGuideProgress) => void) => () => void

  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
  getWindowState: () => Promise<WindowState>
  setFullscreen: (enabled: boolean) => Promise<WindowState>
  toggleFullscreen: () => Promise<WindowState>
  exitFullscreen: () => Promise<WindowState>
  setAlwaysOnTop: (enabled: boolean) => Promise<WindowState>
  toggleAlwaysOnTop: () => Promise<WindowState>
  onWindowStateChanged: (listener: (state: WindowState) => void) => () => void

  loadPlayerState: () => Promise<PlayerState | null>
  savePlayerState: (state: PlayerState) => Promise<void>

  saveConfig: (config: AIConfig) => Promise<string>
  loadConfig: () => Promise<AIConfig | null>
  savePresets: (presets: Preset[]) => Promise<void>
  loadPresets: () => Promise<Preset[]>
  saveRecentPlaylist: (path: string) => Promise<void>
  loadRecentPlaylist: () => Promise<string | null>
  saveSettings: (settings: { subtitleSize: number; subtitleOffset: number }) => Promise<void>
  loadSettings: () => Promise<{ subtitleSize: number; subtitleOffset: number } | null>
}
