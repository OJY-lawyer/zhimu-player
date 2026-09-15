import { useEffect, useMemo, useRef, useState } from 'react'
import type { ActivePlaylist } from '../playerTypes'
import { formatTime } from '../utils/srtParser'
import { buildGuideNavigation } from '../../shared/guideManifest'
import { Icon } from './Icons'
import { t, translateMessage } from '../i18n'

interface SearchResult {
  key: string
  source: 'subtitle' | 'guide'
  partIndex: number
  time: number
  text: string
  disabledReason?: string
}

interface SearchOverlayProps {
  open: boolean
  playlist: ActivePlaylist | null
  guideText: string
  onClose: () => void
  onNavigate: (result: SearchResult) => void
}

function parseGuideTimestamp(line: string): { partIndex: number; time: number } | null {
  const partMatch = line.match(/\[P(\d+)-(\d{1,3}):(\d{2})(?::(\d{2}))?\]/i)
  const plainMatch = line.match(/\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/)
  const match = partMatch || plainMatch
  if (!match) return null
  const hasPart = Boolean(partMatch)
  const offset = hasPart ? 2 : 1
  const hasHours = match[offset + 2] !== undefined
  const first = Number(match[offset])
  const second = Number(match[offset + 1])
  const third = Number(match[offset + 2] || 0)
  return {
    partIndex: hasPart ? Math.max(0, Number(match[1]) - 1) : 0,
    time: hasHours ? first * 3600 + second * 60 + third : first * 60 + second,
  }
}

export function SearchOverlay({
  open,
  playlist,
  guideText,
  onClose,
  onNavigate,
}: SearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
    window.setTimeout(() => inputRef.current?.focus(), 0)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!open || !normalized || !playlist) return [] as SearchResult[]
    const found: SearchResult[] = []
    playlist.items.forEach((item, partIndex) => {
      item.subtitles.forEach((subtitle, subtitleIndex) => {
        if (subtitle.text.toLocaleLowerCase().includes(normalized)) {
          found.push({
            key: 'subtitle:' + item.id + ':' + subtitleIndex,
            source: 'subtitle',
            partIndex,
            time: Math.max(0, subtitle.startTime - item.subtitleOffset),
            text: subtitle.text,
          })
        }
      })
    })
    const guide = buildGuideNavigation(guideText, playlist.items.map((item) => item.name))
    let guideTarget: { partIndex: number; time: number } | null = null
    guide.body.split(/\r?\n/).forEach((line, index) => {
      const parsedTarget = parseGuideTimestamp(line)
      if (parsedTarget) {
        const mappedPart = guide.partMap[parsedTarget.partIndex] ?? null
        guideTarget = mappedPart === null ? null : { partIndex: mappedPart, time: parsedTarget.time }
      }
      if (!line.toLocaleLowerCase().includes(normalized)) return
      found.push({
        key: 'guide:' + index,
        source: 'guide',
        partIndex: guideTarget?.partIndex ?? -1,
        time: guideTarget?.time ?? 0,
        text: line.replace(/^#+\s*/, ''),
        disabledReason: guideTarget ? undefined : '这段文字没有可确认的视频位置，仍可在导读中阅读。',
      })
    })
    return found.slice(0, 120)
  }, [guideText, open, playlist, query])

  if (!open) return null

  return (
    <div className="search-overlay" role="dialog" aria-modal="true" aria-label={t('搜索字幕与导读', 'Search subtitles and guide')}>
      <div className="search-box">
        <Icon name="search" size={18} />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder={t('搜索当前播放列表的字幕与导读', 'Search subtitles and guide in this playlist')}
          aria-label={t('搜索关键词', 'Search query')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="search-results">
        {!query.trim() ? (
          <div className="search-hint">{t('输入关键词，结果会同时覆盖全部 Part 的字幕和当前导读。', 'Search across subtitles in every part and the current guide.')}</div>
        ) : results.length === 0 ? (
          <div className="search-hint">{t(`没有找到“${query}”`, `No results for “${query}”`)}</div>
        ) : results.map((result) => (
          <button
            key={result.key}
            type="button"
            disabled={Boolean(result.disabledReason)}
            title={result.disabledReason ? translateMessage(result.disabledReason) : undefined}
            onClick={() => {
              onNavigate(result)
              onClose()
            }}
          >
            <span className="search-result-source">{result.source === 'subtitle' ? t('字幕', 'Subtitles') : t('导读', 'Guide')}</span>
            <span className="search-result-location">{result.disabledReason ? t('仅文本', 'Text only') : 'P' + (result.partIndex + 1) + ' · ' + formatTime(result.time)}</span>
            <span className="search-result-text">{result.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export type { SearchResult }
