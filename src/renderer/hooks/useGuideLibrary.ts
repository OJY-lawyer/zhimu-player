import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActivePlaylist } from '../playerTypes'
import { attachGuideManifest, replaceGuideBody } from '../../shared/guideManifest'

export interface GuideVersion {
  path: string
  filename: string
  displayName: string
  timestamp: string
}

function dirname(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  if (separator < 0) return normalized
  if (separator === 2 && /^[a-z]:\//i.test(normalized)) return normalized.slice(0, 3)
  return normalized.slice(0, separator)
}

function timestampLabel(timestamp: string) {
  const digits = timestamp.replace('-', '')
  if (digits.length !== 14) return timestamp
  return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8)
    + ' ' + digits.slice(8, 10) + ':' + digits.slice(10, 12)
}

function extractTimestamp(filename: string) {
  const match = filename.match(/(\d{8}-?\d{6})(?=\.md$)/)
  return match?.[1] || ''
}

function localTimestamp() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return String(now.getFullYear()) + pad(now.getMonth() + 1) + pad(now.getDate())
    + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
}

export function useGuideLibrary(playlist: ActivePlaylist | null, preferredPath?: string) {
  const [versions, setVersions] = useState<GuideVersion[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownerPlaylistId, setOwnerPlaylistId] = useState<string | null>(null)
  const draftsRef = useRef(new Map<string, { content: string }>())
  const pendingSaveRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const saveTimerRef = useRef<number | null>(null)
  const activePathRef = useRef<string | null>(null)
  const contentRef = useRef('')
  const requestRef = useRef(0)
  const playlistIdRef = useRef(playlist?.id || null)
  activePathRef.current = activePath
  contentRef.current = content
  playlistIdRef.current = playlist?.id || null

  const folderPath = playlist?.items[0] ? dirname(playlist.items[0].path) : ''
  const singleStem = playlist?.items.length === 1 ? playlist.items[0].stem : ''

  const flushDirty = useCallback(async () => {
    const pending = pendingSaveRef.current.catch(() => false).then(async () => {
      let allSaved = true
      for (const path of [...draftsRef.current.keys()]) {
        const draft = draftsRef.current.get(path)
        if (!draft) continue
        let saved = false
        try {
          saved = await window.electronAPI.writeFile(path, draft.content)
        } catch {
          // Keep the draft available when a removable drive or IPC is unavailable.
        }
        if (saved) {
          if (draftsRef.current.get(path) === draft) draftsRef.current.delete(path)
        } else {
          allSaved = false
          setError('导读尚未保存，编辑内容仍保留在播放器中：' + path)
        }
      }
      return allSaved && draftsRef.current.size === 0
    })
    pendingSaveRef.current = pending
    return pending
  }, [])

  const refresh = useCallback(async (selectedPath?: string, allowUnsavedDrafts = false) => {
    const request = ++requestRef.current
    const targetPlaylistId = playlist?.id || null
    const isCurrent = () => request === requestRef.current && targetPlaylistId === playlistIdRef.current
    const saved = await flushDirty()
    if (!isCurrent()) return false
    if (!saved && !allowUnsavedDrafts) return false
    if (!playlist || !folderPath) {
      setVersions([])
      setActivePath(null)
      activePathRef.current = null
      setContent('')
      setOwnerPlaylistId(null)
      return true
    }
    setIsLoading(true)
    if (saved) setError(null)
    try {
      const files = await window.electronAPI.readDir(folderPath)
      if (!isCurrent()) return false
      const candidates = files
        .filter((filename) => {
          if (!filename.toLocaleLowerCase().endsWith('.md')) return false
          if (playlist.items.length === 1) {
            const legacySummary = new RegExp('^' + singleStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_.+_\\d{14}\\.md$', 'i')
            return legacySummary.test(filename)
              || filename.startsWith(singleStem + '.导读.')
              || filename.startsWith(singleStem + '.Guide.')
              || filename.includes('_全局总结_')
          }
          return filename.includes('导读') || filename.includes('全局总结') || filename.includes('.Guide.')
        })
        .map((filename) => {
          const timestamp = extractTimestamp(filename)
          return {
            path: folderPath + (folderPath.endsWith('/') ? '' : '/') + filename,
            filename,
            timestamp,
            displayName: timestamp ? timestampLabel(timestamp) : filename.replace(/\.md$/i, ''),
          }
        })
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      const nextPath = candidates.find((version) => version.path === selectedPath)?.path
        || candidates.find((version) => version.path === preferredPath)?.path
        || candidates.find((version) => version.path === activePath)?.path
        || candidates[0]?.path
        || null
      const loaded = nextPath ? await window.electronAPI.readFile(nextPath) || '' : ''
      if (!isCurrent()) return false
      setVersions(candidates)
      setActivePath(nextPath)
      activePathRef.current = nextPath
      setContent(nextPath ? draftsRef.current.get(nextPath)?.content ?? loaded : '')
      setOwnerPlaylistId(targetPlaylistId)
      return true
    } catch {
      if (isCurrent()) setError('读取导读文件失败。')
      return false
    } finally {
      if (isCurrent()) setIsLoading(false)
    }
  }, [activePath, flushDirty, folderPath, playlist, preferredPath, singleStem])

  useEffect(() => {
    setVersions([])
    setActivePath(null)
    activePathRef.current = null
    setContent('')
    setOwnerPlaylistId(null)
    // A failed outgoing save stays in draftsRef and is restored on return.
    void refresh(undefined, true)
    return () => { requestRef.current += 1 }
  }, [playlist?.id])

  const selectVersion = useCallback(async (path: string) => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const request = ++requestRef.current
    const targetPlaylistId = playlistIdRef.current
    const isCurrent = () => request === requestRef.current && targetPlaylistId === playlistIdRef.current
    if (!await flushDirty() || !isCurrent()) return
    let loaded: string
    try {
      loaded = await window.electronAPI.readFile(path) || ''
    } catch {
      if (isCurrent()) setError('读取导读文件失败。')
      return
    }
    if (!isCurrent()) return
    setActivePath(path)
    activePathRef.current = path
    setContent(draftsRef.current.get(path)?.content ?? loaded)
    setOwnerPlaylistId(targetPlaylistId)
    setError(null)
    setIsLoading(false)
  }, [flushDirty])

  const updateContent = useCallback((nextContent: string) => {
    const path = activePathRef.current
    if (!path) return
    const original = draftsRef.current.get(path)?.content ?? contentRef.current
    const next = replaceGuideBody(original, nextContent)
    draftsRef.current.set(path, { content: next })
    contentRef.current = next
    setContent(next)
  }, [])

  useEffect(() => {
    if (!activePath || !draftsRef.current.has(activePath)) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(async () => {
      saveTimerRef.current = null
      await flushDirty()
    }, 800)
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [activePath, content, flushDirty])

  useEffect(() => {
    const flush = () => { void flushDirty() }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      void flushDirty()
    }
  }, [flushDirty])

  const createVersion = useCallback(async (guideContent: string, label = '导读') => {
    if (!playlist || !folderPath) return null
    const safeName = playlist.displayName.replace(/[<>:"/\\|?*]/g, '_')
    const safeLabel = label.replace(/[<>:"/\\|?*]/g, '_')
    const filename = safeName + '.' + safeLabel + '.' + localTimestamp() + '.md'
    const path = folderPath + (folderPath.endsWith('/') ? '' : '/') + filename
    const document = attachGuideManifest(guideContent, playlist.items.map((item) => item.name))
    const saved = await window.electronAPI.writeFile(path, document)
    if (!saved) {
      if (playlistIdRef.current === playlist.id) setError('保存新导读版本失败。')
      return null
    }
    if (playlistIdRef.current === playlist.id) await refresh(path)
    return path
  }, [folderPath, playlist, refresh])

  const ownsView = ownerPlaylistId === (playlist?.id || null)
  const activeVersion = useMemo(
    () => ownsView ? versions.find((version) => version.path === activePath) || null : null,
    [activePath, ownsView, versions],
  )

  return {
    versions: ownsView ? versions : [],
    activeVersion,
    content: ownsView ? content : '',
    ownerPlaylistId,
    isLoading,
    error,
    refresh,
    selectVersion,
    updateContent,
    createVersion,
    flushDirty,
  }
}
