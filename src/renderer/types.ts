import type { ElectronAPI as SharedElectronAPI } from '../shared/contracts'

export type {
  DrawerTab,
  MediaFile,
  MediaFolderSelection,
  PersistedPlaylistState,
  PersistedVideoState,
  PlayerState,
  VideoExtension,
  WindowState
} from '../shared/contracts'

// Subtitle type from SRT parser
export interface Subtitle {
  index: number
  startTime: number
  endTime: number
  text: string
}

// AI Config for OpenAI-compatible API
export type AIConfig = import('../shared/contracts').AIConfig

// Model Preset
export interface Preset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface SummaryFileInfo {
  path: string       // full path to summary file
  model: string      // model name parsed from filename
  timestamp: string  // YYYYMMDDHHmmss format
  displayName: string // e.g. "gpt-4o-mini (2025-04-28 14:30)"
}

// Playlist item
export interface PlaylistItem {
  id: string
  videoPath: string
  videoName: string
  subtitles?: Subtitle[]
  summary?: string
  order: number
  availableSummaryFiles?: SummaryFileInfo[]
  summaryModel?: string
}

// Playlist file format
export interface PlaylistFile {
  version: number
  playlistPath: string
  items: {
    videoPath: string
    subtitlePath?: string
    order: number
  }[]
}

// Electron API exposed to renderer
export interface ElectronAPI extends SharedElectronAPI {}

// Video player state
export interface VideoPlayerState {
  src: string
  filePath: string
  currentTime: number
  duration: number
  isPlaying: boolean
}

// Subtitle settings
export interface SubtitleSettings {
  offset: number
  size: number
}

// Sidebar state
export interface SidebarState {
  open: boolean
  width: number
}

// Resize state
export interface ResizeState {
  isDragging: boolean
}

// Declare global electronAPI
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
