import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DrawerTab,
  MediaFile,
  MediaFolderSelection,
  PersistedPlaylistState,
  PlayerState,
} from '../../shared/contracts'
import type { ActivePlaylist, PlayerPlaylistItem, SubtitleSource, SubtitleStyle } from '../playerTypes'
import { parseSRT, serializeSRT, type Subtitle } from '../utils/srtParser'

const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  visible: true,
  size: 22,
  verticalPosition: 10,
  backgroundOpacity: 0.58,
}

function createDefaultState(): PlayerState {
  return {
    version: 1,
    activePlaylistId: null,
    volume: 1,
    muted: false,
    autoplayNext: true,
    alwaysOnTop: false,
    drawer: { pinned: false, width: 420 },
    subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    playlists: {},
    updatedAt: new Date().toISOString(),
  }
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').toLocaleLowerCase()
}

function dirname(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  if (separator < 0) return normalized
  if (separator === 2 && /^[a-z]:\//i.test(normalized)) return normalized.slice(0, 3)
  return normalized.slice(0, separator)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function playlistId(kind: PersistedPlaylistState['sourceKind'], sourcePath: string) {
  return `${kind}:${normalizePath(sourcePath)}`
}

async function discoverSubtitle(
  media: MediaFile,
  directoryFiles: string[],
): Promise<{ path?: string; source: SubtitleSource; subtitles: Subtitle[] }> {
  const escapedStem = escapeRegExp(media.stem)
  const revisionPattern = new RegExp(`^${escapedStem}\\.(\\d{8}-\\d{6})\\.srt$`, 'i')
  const revisions = directoryFiles
    .map((name) => ({ name, match: name.match(revisionPattern) }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => Boolean(entry.match))
    .sort((left, right) => right.match[1].localeCompare(left.match[1]))

  let filename: string | undefined
  let source: SubtitleSource = 'none'
  if (revisions.length > 0) {
    filename = revisions[0].name
    source = 'revision'
  } else {
    const exact = directoryFiles.find((name) => name.toLocaleLowerCase() === `${media.stem}.srt`.toLocaleLowerCase())
    if (exact) {
      filename = exact
      source = 'sidecar'
    }
  }

  if (!filename) return { source, subtitles: [] }
  const directory = dirname(media.path)
  const path = directory.endsWith('/') ? directory + filename : `${directory}/${filename}`
  const content = await window.electronAPI.readFile(path)
  return { path, source, subtitles: content ? parseSRT(content) : [] }
}

function toPersistedPlaylist(playlist: ActivePlaylist, activeDrawerTab: DrawerTab): PersistedPlaylistState {
  return {
    id: playlist.id,
    sourcePath: playlist.sourcePath,
    sourceKind: playlist.sourceKind,
    displayName: playlist.displayName,
    activeVideoPath: playlist.items[playlist.currentIndex]?.path || null,
    activeDrawerTab,
    activeGuidePath: playlist.activeGuidePath,
    playbackRate: playlist.playbackRate,
    videos: playlist.items.map((item, index) => ({
      videoPath: item.path,
      subtitlePath: item.subtitlePath,
      order: index,
      lastPosition: item.lastPosition,
      duration: item.duration,
      subtitleOffset: item.subtitleOffset,
      completed: item.completed,
      completionSuppressed: item.completionSuppressed,
      isNew: item.isNew,
    })),
  }
}

interface HydrateOptions {
  id: string
  sourcePath: string
  sourceKind: PersistedPlaylistState['sourceKind']
  displayName: string
  mediaFiles: MediaFile[]
  persisted?: PersistedPlaylistState
}

async function hydratePlaylist(options: HydrateOptions): Promise<ActivePlaylist> {
  const persistedByPath = new Map(
    (options.persisted?.videos || []).map((video) => [normalizePath(video.videoPath), video]),
  )
  const persistedOrder = new Map(
    (options.persisted?.videos || []).map((video) => [normalizePath(video.videoPath), video.order]),
  )
  const naturalOrder = new Map(options.mediaFiles.map((file, index) => [normalizePath(file.path), index]))
  const sortedFiles = [...options.mediaFiles].sort((left, right) => {
    const leftOrder = persistedOrder.get(normalizePath(left.path))
    const rightOrder = persistedOrder.get(normalizePath(right.path))
    if (leftOrder !== undefined && rightOrder !== undefined) return leftOrder - rightOrder
    if (leftOrder !== undefined) return -1
    if (rightOrder !== undefined) return 1
    return (naturalOrder.get(normalizePath(left.path)) || 0) - (naturalOrder.get(normalizePath(right.path)) || 0)
  })

  const directoryCache = new Map<string, string[]>()
  const items: PlayerPlaylistItem[] = []
  for (let index = 0; index < sortedFiles.length; index += 1) {
    const media = sortedFiles[index]
    const directory = dirname(media.path)
    let directoryFiles = directoryCache.get(directory)
    if (!directoryFiles) {
      directoryFiles = await window.electronAPI.readDir(directory)
      directoryCache.set(directory, directoryFiles)
    }
    const subtitle = await discoverSubtitle(media, directoryFiles)
    const previous = persistedByPath.get(normalizePath(media.path))
    items.push({
      ...media,
      id: normalizePath(media.path),
      order: index,
      subtitlePath: subtitle.path,
      subtitleSource: subtitle.source,
      subtitles: subtitle.subtitles,
      lastPosition: previous?.lastPosition || 0,
      duration: previous?.duration || 0,
      subtitleOffset: previous?.subtitleOffset || 0,
      completed: previous?.completed || false,
      completionSuppressed: previous?.completionSuppressed || false,
      isNew: previous ? previous.isNew : Boolean(options.persisted),
    })
  }

  const activePath = normalizePath(options.persisted?.activeVideoPath || '')
  const restoredIndex = items.findIndex((item) => normalizePath(item.path) === activePath)
  return {
    id: options.id,
    sourcePath: options.sourcePath,
    sourceKind: options.sourceKind,
    displayName: options.displayName,
    items,
    currentIndex: restoredIndex >= 0 ? restoredIndex : 0,
    playbackRate: options.persisted?.playbackRate || 1,
    activeGuidePath: options.persisted?.activeGuidePath,
  }
}

export function usePlayerSession() {
  const [playlist, setPlaylistState] = useState<ActivePlaylist | null>(null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [autoplayNext, setAutoplayNext] = useState(true)
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE)
  const [drawerPreferences, setDrawerPreferencesState] = useState({ pinned: false, width: 420 })
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('playlist')
  const persistedStateRef = useRef<PlayerState>(createDefaultState())
  const revisionPathRef = useRef(new Map<string, string>())
  const activationRequestRef = useRef(0)
  const saveTimerRef = useRef<number | null>(null)
  const latestRef = useRef({ playlist, volume, muted, autoplayNext, subtitleStyle, activeDrawerTab })
  latestRef.current = { playlist, volume, muted, autoplayNext, subtitleStyle, activeDrawerTab }

  const setPlaylist = useCallback((update: ActivePlaylist | null | ((current: ActivePlaylist | null) => ActivePlaylist | null)) => {
    const next = typeof update === 'function' ? update(latestRef.current.playlist) : update
    latestRef.current = { ...latestRef.current, playlist: next }
    setPlaylistState(next)
  }, [])

  const persistNow = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const latest = latestRef.current
    const previous = persistedStateRef.current
    const playlists = { ...previous.playlists }
    if (latest.playlist) {
      playlists[latest.playlist.id] = toPersistedPlaylist(latest.playlist, latest.activeDrawerTab)
    }
    const next: PlayerState = {
      ...previous,
      activePlaylistId: latest.playlist?.id || null,
      volume: latest.volume,
      muted: latest.muted,
      autoplayNext: latest.autoplayNext,
      subtitleStyle: latest.subtitleStyle,
      playlists,
      updatedAt: new Date().toISOString(),
    }
    persistedStateRef.current = next
    await window.electronAPI.savePlayerState(next)
  }, [])

  const activateMedia = useCallback(async (
    sourceKind: PersistedPlaylistState['sourceKind'],
    sourcePath: string,
    displayName: string,
    mediaFiles: MediaFile[],
  ) => {
    const requestId = ++activationRequestRef.current
    if (mediaFiles.length === 0) {
      setError('这个位置没有可播放的视频文件。')
      return
    }
    setError(null)
    const outgoing = latestRef.current
    if (outgoing.playlist) {
      const outgoingState: PlayerState = {
        ...persistedStateRef.current,
        volume: outgoing.volume,
        muted: outgoing.muted,
        autoplayNext: outgoing.autoplayNext,
        subtitleStyle: outgoing.subtitleStyle,
        playlists: {
          ...persistedStateRef.current.playlists,
          [outgoing.playlist.id]: toPersistedPlaylist(outgoing.playlist, outgoing.activeDrawerTab),
        },
        updatedAt: new Date().toISOString(),
      }
      persistedStateRef.current = outgoingState
      await window.electronAPI.savePlayerState(outgoingState)
    }
    const id = playlistId(sourceKind, sourcePath)
    const persisted = persistedStateRef.current.playlists[id]
    const next = await hydratePlaylist({
      id,
      sourceKind,
      sourcePath,
      displayName,
      mediaFiles,
      persisted,
    })
    if (requestId !== activationRequestRef.current) return
    setPlaylist(next)
    setActiveDrawerTab(persisted?.activeDrawerTab || 'playlist')
    persistedStateRef.current = { ...persistedStateRef.current, activePlaylistId: id }
  }, [])

  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      try {
        const saved = await window.electronAPI.loadPlayerState()
        if (cancelled) return
        const state = saved?.version === 1 ? saved : createDefaultState()
        persistedStateRef.current = state
        setVolume(state.volume)
        setMuted(state.muted)
        setAutoplayNext(state.autoplayNext)
        setSubtitleStyle({ ...DEFAULT_SUBTITLE_STYLE, ...state.subtitleStyle })
        setDrawerPreferencesState(state.drawer)
        if (state.alwaysOnTop) await window.electronAPI.setAlwaysOnTop(true)

        const active = state.activePlaylistId ? state.playlists[state.activePlaylistId] : null
        if (!active) return
        if (active.sourceKind === 'folder') {
          const files = await window.electronAPI.scanVideoDirectory(active.sourcePath)
          if (!cancelled) await activateMedia('folder', active.sourcePath, active.displayName, files)
        } else {
          const media = await window.electronAPI.resolveMediaFile(active.sourcePath)
          if (!cancelled && media) {
            await activateMedia('single-video', active.sourcePath, active.displayName, [media])
          } else if (!cancelled) {
            setError('上次打开的单个视频已经移动或删除，请重新选择。')
          }
        }
      } catch {
        if (!cancelled) setError('上次打开的位置已经不可用，请重新选择视频或文件夹。')
      } finally {
        if (!cancelled) setIsRestoring(false)
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [activateMedia])

  useEffect(() => {
    if (isRestoring || saveTimerRef.current !== null) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistNow().catch(() => setError('播放状态保存失败，请检查本地存储是否可写。'))
    }, 5000)
  }, [playlist, volume, muted, autoplayNext, subtitleStyle, activeDrawerTab, drawerPreferences, isRestoring, persistNow])

  useEffect(() => {
    const flush = () => { void persistNow().catch(() => undefined) }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [persistNow])

  const openVideo = useCallback(async () => {
    const media = await window.electronAPI.selectVideoFile()
    if (media) await activateMedia('single-video', media.path, media.stem, [media])
  }, [activateMedia])

  const openFolder = useCallback(async () => {
    const selection: MediaFolderSelection | null = await window.electronAPI.selectVideoFolder()
    if (selection) await activateMedia('folder', selection.folderPath, selection.folderName, selection.files)
  }, [activateMedia])

  const reloadPlaylist = useCallback(async () => {
    const current = latestRef.current.playlist
    if (!current) return
    if (current.sourceKind === 'folder') {
      const files = await window.electronAPI.scanVideoDirectory(current.sourcePath)
      await activateMedia('folder', current.sourcePath, current.displayName, files)
      return
    }
    const media = await window.electronAPI.resolveMediaFile(current.sourcePath)
    if (media) await activateMedia('single-video', media.path, media.stem, [media])
  }, [activateMedia])

  const openDroppedMedia = useCallback(async (droppedPath: string) => {
    const selection = await window.electronAPI.resolveDroppedMedia(droppedPath)
    if (!selection) {
      setError('拖入的位置不是视频文件或文件夹。')
      return
    }
    await activateMedia(
      selection.sourceKind,
      selection.sourcePath,
      selection.displayName,
      selection.files,
    )
  }, [activateMedia])

  const selectItem = useCallback((index: number, fromStart = false) => {
    setPlaylist((current) => {
      if (!current || index < 0 || index >= current.items.length) return current
      const items = fromStart
        ? current.items.map((item, itemIndex) => itemIndex === index ? { ...item, lastPosition: 0 } : item)
        : current.items
      return { ...current, items, currentIndex: index }
    })
  }, [])

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setPlaylist((current) => {
      if (!current || fromIndex === toIndex) return current
      const activeId = current.items[current.currentIndex]?.id
      const items = [...current.items]
      const [moved] = items.splice(fromIndex, 1)
      items.splice(toIndex, 0, moved)
      const reordered = items.map((item, index) => ({ ...item, order: index }))
      const currentIndex = Math.max(0, reordered.findIndex((item) => item.id === activeId))
      return { ...current, items: reordered, currentIndex }
    })
  }, [])

  const naturalSort = useCallback(() => {
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
    setPlaylist((current) => {
      if (!current) return current
      const activeId = current.items[current.currentIndex]?.id
      const items = [...current.items]
        .sort((left, right) => collator.compare(left.name, right.name))
        .map((item, index) => ({ ...item, order: index }))
      const currentIndex = Math.max(0, items.findIndex((item) => item.id === activeId))
      return { ...current, items, currentIndex }
    })
  }, [])

  const updateProgress = useCallback((time: number, duration: number) => {
    setPlaylist((current) => {
      if (!current) return current
      const index = current.currentIndex
      const item = current.items[index]
      if (!item) return current
      const ratio = duration > 0 ? time / duration : 0
      const completionSuppressed = item.completionSuppressed && ratio >= 0.9
      const completed = !completionSuppressed && ratio >= 0.95 ? true : item.completed
      const items = current.items.map((entry, itemIndex) => itemIndex === index
        ? { ...entry, lastPosition: time, duration, completed, completionSuppressed }
        : entry)
      return { ...current, items }
    })
  }, [])

  const setCompleted = useCallback((index: number, completed: boolean) => {
    setPlaylist((current) => current ? {
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index
        ? { ...item, completed, completionSuppressed: !completed }
        : item),
    } : current)
  }, [])

  const setPlaybackRate = useCallback((playbackRate: number) => {
    setPlaylist((current) => current ? { ...current, playbackRate } : current)
  }, [])

  const setCurrentSubtitleOffset = useCallback((subtitleOffset: number) => {
    setPlaylist((current) => {
      if (!current) return current
      return {
        ...current,
        items: current.items.map((item, index) => index === current.currentIndex
          ? { ...item, subtitleOffset }
          : item),
      }
    })
  }, [])

  const setActiveGuidePath = useCallback((activeGuidePath: string | undefined) => {
    setPlaylist((current) => current ? { ...current, activeGuidePath } : current)
  }, [])

  const advanceToNext = useCallback(() => {
    setPlaylist((current) => {
      if (!current) return current
      const items = current.items.map((item, index) => index === current.currentIndex
        ? { ...item, completed: true, lastPosition: item.duration || item.lastPosition }
        : item)
      const nextIndex = autoplayNext && current.currentIndex < items.length - 1
        ? current.currentIndex + 1
        : current.currentIndex
      return { ...current, items, currentIndex: nextIndex }
    })
  }, [autoplayNext])

  const saveSubtitleRevision = useCallback(async (subtitles: Subtitle[]) => {
    const current = latestRef.current.playlist
    if (!current) return false
    const item = current.items[current.currentIndex]
    if (!item) return false
    const targetPlaylistId = current.id
    const targetItemId = item.id
    if (subtitles.some((subtitle) => !Number.isFinite(subtitle.startTime)
      || !Number.isFinite(subtitle.endTime) || subtitle.startTime < 0 || subtitle.endTime <= subtitle.startTime)) {
      setError('字幕时间无效，修订版尚未保存。')
      return false
    }
    const orderedSubtitles = [...subtitles]
      .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime || left.index - right.index)
      .map((subtitle, index) => ({ ...subtitle, index: index + 1 }))
    let path = revisionPathRef.current.get(item.path)
    if (!path) {
      const now = new Date()
      const pad = (value: number) => String(value).padStart(2, '0')
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
      const directory = dirname(item.path)
      path = `${directory}${directory.endsWith('/') ? '' : '/'}${item.stem}.${timestamp}.srt`
      revisionPathRef.current.set(item.path, path)
    }
    const saved = await window.electronAPI.writeFile(path, serializeSRT(orderedSubtitles))
    if (!saved) return false
    setPlaylist((active) => active && active.id === targetPlaylistId ? {
      ...active,
      items: active.items.map((entry) => entry.id === targetItemId
        ? { ...entry, subtitles: orderedSubtitles, subtitlePath: path, subtitleSource: 'revision' }
        : entry),
    } : active)
    return true
  }, [])

  const setDrawerPreferences = useCallback((pinned: boolean, width: number) => {
    setDrawerPreferencesState({ pinned, width })
    persistedStateRef.current = {
      ...persistedStateRef.current,
      drawer: { pinned, width },
    }
  }, [])

  const setAlwaysOnTopPreference = useCallback((alwaysOnTop: boolean) => {
    persistedStateRef.current = { ...persistedStateRef.current, alwaysOnTop }
  }, [])

  const activeItem = useMemo(
    () => playlist?.items[playlist.currentIndex] || null,
    [playlist],
  )

  return {
    playlist,
    activeItem,
    isRestoring,
    error,
    volume,
    muted,
    autoplayNext,
    subtitleStyle,
    drawerPreferences,
    activeDrawerTab,
    openVideo,
    openFolder,
    reloadPlaylist,
    openDroppedMedia,
    selectItem,
    reorder,
    naturalSort,
    updateProgress,
    setCompleted,
    setPlaybackRate,
    setVolume,
    setMuted,
    setAutoplayNext,
    setSubtitleStyle,
    setCurrentSubtitleOffset,
    setActiveGuidePath,
    advanceToNext,
    saveSubtitleRevision,
    setDrawerPreferences,
    setActiveDrawerTab,
    setAlwaysOnTopPreference,
    persistNow,
  }
}
