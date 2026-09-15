import type { MediaFile, PersistedPlaylistState } from '../shared/contracts'
import type { Subtitle } from './utils/srtParser'

export type SubtitleSource = 'none' | 'sidecar' | 'revision'

export interface PlayerPlaylistItem extends MediaFile {
  id: string
  order: number
  subtitlePath?: string
  subtitleSource: SubtitleSource
  subtitles: Subtitle[]
  lastPosition: number
  duration: number
  subtitleOffset: number
  completed: boolean
  completionSuppressed: boolean
  isNew: boolean
}

export interface ActivePlaylist {
  id: string
  sourcePath: string
  sourceKind: PersistedPlaylistState['sourceKind']
  displayName: string
  items: PlayerPlaylistItem[]
  currentIndex: number
  playbackRate: number
  activeGuidePath?: string
}

export interface SubtitleStyle {
  visible: boolean
  size: number
  verticalPosition: number
  backgroundOpacity: number
}
