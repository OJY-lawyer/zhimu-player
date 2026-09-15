import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SubtitleSource } from '../playerTypes'
import { findSubtitleIndex, formatTime, type Subtitle } from '../utils/srtParser'
import { Icon } from './Icons'
import { t, translateMessage } from '../i18n'

interface SubtitleBrowserProps {
  subtitles: Subtitle[]
  currentTime: number
  subtitleOffset: number
  subtitleSource: SubtitleSource
  onSeek: (time: number) => void
  onExport: () => void
  onSaveRevision: (subtitles: Subtitle[]) => Promise<boolean>
}

interface DraftSubtitle {
  index: number
  startTime: number
  endTime: number
  text: string
}

function formatEditTime(seconds: number) {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const wholeSeconds = Math.floor(safe % 60)
  const milliseconds = Math.round((safe - Math.floor(safe)) * 1000)
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    wholeSeconds.toString().padStart(2, '0'),
  ].join(':') + '.' + milliseconds.toString().padStart(3, '0')
}

function parseEditTime(value: string): number | null {
  const match = value.trim().match(/^(\d{1,3}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/)
  if (!match) return null
  const milliseconds = Number((match[4] || '0').padEnd(3, '0'))
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + milliseconds / 1000
}

export function SubtitleBrowser({
  subtitles,
  currentTime,
  subtitleOffset,
  subtitleSource,
  onSeek,
  onExport,
  onSaveRevision,
}: SubtitleBrowserProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const followTimerRef = useRef<number | null>(null)
  const lastFollowAtRef = useRef(0)
  const [isFollowing, setIsFollowing] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [draft, setDraft] = useState<DraftSubtitle | null>(null)
  const [startInput, setStartInput] = useState('')
  const [endInput, setEndInput] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const currentIndex = useMemo(
    () => findSubtitleIndex(subtitles, currentTime + subtitleOffset),
    [currentTime, subtitleOffset, subtitles],
  )

  const scrollToCurrent = useCallback((behavior: ScrollBehavior = 'smooth') => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior })
    lastFollowAtRef.current = Date.now()
  }, [])

  useEffect(() => {
    if (!isFollowing || currentIndex < 0) return
    if (followTimerRef.current !== null) window.clearTimeout(followTimerRef.current)
    const wait = Math.max(0, 1000 - (Date.now() - lastFollowAtRef.current))
    followTimerRef.current = window.setTimeout(() => {
      followTimerRef.current = null
      scrollToCurrent()
    }, wait)
    return () => {
      if (followTimerRef.current !== null) {
        window.clearTimeout(followTimerRef.current)
        followTimerRef.current = null
      }
    }
  }, [currentIndex, isFollowing, scrollToCurrent])

  useEffect(() => {
    const closeMenu = () => setMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [])

  const beginEdit = useCallback((index: number) => {
    const subtitle = subtitles[index]
    if (!subtitle) return
    const nextDraft = { ...subtitle, index }
    setDraft(nextDraft)
    setStartInput(formatEditTime(subtitle.startTime))
    setEndInput(formatEditTime(subtitle.endTime))
    setEditError(null)
    setMenu(null)
    setIsFollowing(false)
  }, [subtitles])

  const nudge = useCallback((field: 'startTime' | 'endTime', delta: number) => {
    setDraft((current) => {
      if (!current) return current
      const next = { ...current, [field]: Math.max(0, Number((current[field] + delta).toFixed(3))) }
      if (field === 'startTime') setStartInput(formatEditTime(next.startTime))
      else setEndInput(formatEditTime(next.endTime))
      return next
    })
  }, [])

  const saveEdit = useCallback(async () => {
    if (!draft) return
    const startTime = parseEditTime(startInput)
    const endTime = parseEditTime(endInput)
    if (startTime === null || endTime === null) {
      setEditError('时间格式应为 00:00:00.000。')
      return
    }
    if (startTime >= endTime) {
      setEditError('结束时间必须晚于开始时间。')
      return
    }
    const updated = subtitles.map((subtitle, index) => index === draft.index
      ? { ...subtitle, startTime, endTime, text: draft.text }
      : subtitle)
    setIsSaving(true)
    const saved = await onSaveRevision(updated)
    setIsSaving(false)
    if (!saved) {
      setEditError('保存失败，请检查视频目录是否可写。')
      return
    }
    setDraft(null)
    setEditError(null)
    setIsFollowing(true)
  }, [draft, endInput, onSaveRevision, startInput, subtitles])

  const statusText = subtitleSource === 'revision'
    ? t('已加载时间戳修订版', 'Timestamped revision loaded')
    : subtitleSource === 'sidecar'
      ? t('已加载外挂字幕', 'External subtitles loaded')
      : t('当前视频没有字幕', 'No subtitles for this video')

  return (
    <section className="drawer-panel subtitle-panel">
      <div className="panel-toolbar">
        <div>
          <strong>{t('字幕流', 'Subtitles')}</strong>
          <span>{statusText}</span>
        </div>
        <button className="text-button" type="button" disabled={subtitles.length === 0} onClick={onExport}>
          {t('导出 Markdown', 'Export Markdown')}
        </button>
      </div>

      {draft && (
        <div className="subtitle-editor">
          <div className="subtitle-editor-heading">
            <strong>{t('编辑字幕', 'Edit subtitle')}</strong>
            <span>{t('将另存为带时间戳的修订版', 'Saved as a timestamped revision')}</span>
          </div>
          <textarea
            aria-label={t('字幕文字', 'Subtitle text')}
            value={draft.text}
            rows={4}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
          />
          <div className="subtitle-time-editor">
            <label>
              <span>{t('开始', 'Start')}</span>
              <input value={startInput} onChange={(event) => setStartInput(event.target.value)} />
              <div className="nudge-buttons">
                <button type="button" onClick={() => nudge('startTime', -0.5)}>−0.5</button>
                <button type="button" onClick={() => nudge('startTime', -0.1)}>−0.1</button>
                <button type="button" onClick={() => nudge('startTime', 0.1)}>+0.1</button>
                <button type="button" onClick={() => nudge('startTime', 0.5)}>+0.5</button>
              </div>
            </label>
            <label>
              <span>{t('结束', 'End')}</span>
              <input value={endInput} onChange={(event) => setEndInput(event.target.value)} />
              <div className="nudge-buttons">
                <button type="button" onClick={() => nudge('endTime', -0.5)}>−0.5</button>
                <button type="button" onClick={() => nudge('endTime', -0.1)}>−0.1</button>
                <button type="button" onClick={() => nudge('endTime', 0.1)}>+0.1</button>
                <button type="button" onClick={() => nudge('endTime', 0.5)}>+0.5</button>
              </div>
            </label>
          </div>
          {editError && <div className="inline-error">{translateMessage(editError)}</div>}
          <div className="subtitle-editor-actions">
            <button className="button-secondary" type="button" onClick={() => setDraft(null)}>{t('取消', 'Cancel')}</button>
            <button className="button-primary" type="button" disabled={isSaving} onClick={() => void saveEdit()}>
              {isSaving ? t('保存中…', 'Saving…') : t('保存修订版', 'Save revision')}
            </button>
          </div>
        </div>
      )}

      <div
        className="subtitle-list"
        ref={containerRef}
        onWheel={() => setIsFollowing(false)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setIsFollowing(false)
        }}
      >
        {subtitles.length === 0 ? (
          <div className="panel-empty">
            <Icon name="subtitles" size={22} />
            <strong>{t('没有可浏览的字幕', 'No subtitles to browse')}</strong>
            <span>{t('可以导入同名 SRT，或在播放列表中生成缺失字幕。', 'Add an SRT file with the same name as the video, or generate subtitles from the playlist.')}</span>
          </div>
        ) : subtitles.map((subtitle, index) => (
          <button
            key={subtitle.index + ':' + subtitle.startTime}
            ref={index === currentIndex ? activeRef : null}
            className={'subtitle-item ' + (index === currentIndex ? 'is-active' : '')}
            type="button"
            onClick={() => onSeek(subtitle.startTime)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setMenu({ x: event.clientX, y: event.clientY, index })
            }}
          >
            <time>{formatTime(subtitle.startTime)}</time>
            <span>{subtitle.text}</span>
          </button>
        ))}
      </div>

      {!isFollowing && subtitles.length > 0 && (
        <button
          className="follow-current-button"
          type="button"
          onClick={() => {
            setIsFollowing(true)
            scrollToCurrent('auto')
          }}
        >
          {t('回到当前字幕', 'Follow current subtitle')}
        </button>
      )}

      {menu && createPortal(
        <div
          className="context-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 160), top: Math.min(menu.y, window.innerHeight - 48) }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => beginEdit(menu.index)}>{t('编辑这条字幕', 'Edit this subtitle')}</button>
        </div>,
        document.body,
      )}
    </section>
  )
}
