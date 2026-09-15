import { useMemo, useState } from 'react'
import type { GuideVersion } from '../hooks/useGuideLibrary'
import type { ActivePlaylist } from '../playerTypes'
import { buildGuideNavigation } from '../../shared/guideManifest'
import { Icon } from './Icons'
import { t, translateMessage } from '../i18n'

interface GuidePanelProps {
  versions: GuideVersion[]
  activeVersion: GuideVersion | null
  content: string
  isLoading: boolean
  error: string | null
  missingSubtitleNames: string[]
  isGenerating: boolean
  providerLabel: string
  generationMessage?: string
  guideLanguage?: 'zh-CN' | 'en' | 'source'
  onGuideLanguageChange?: (language: 'zh-CN' | 'en' | 'source') => void
  playlist?: ActivePlaylist | null
  onSelectVersion: (path: string) => void
  onContentChange: (content: string) => void
  onGenerate: () => void
  onCancel: () => void
  onOpenSettings: () => void
  onNavigate: (partIndex: number, time: number) => void
}

interface TimestampTarget {
  partIndex: number
  time: number
  label: string
}

function parseTimestamp(match: RegExpMatchArray): TimestampTarget {
  const partIndex = match[1] ? Math.max(0, Number(match[1]) - 1) : 0
  const hasHours = match[4] !== undefined
  const first = Number(match[2])
  const second = Number(match[3])
  const third = Number(match[4] || 0)
  return {
    partIndex,
    time: hasHours ? first * 3600 + second * 60 + third : first * 60 + second,
    label: match[0],
  }
}

function renderTextWithTimestamps(
  text: string,
  lineIndex: number,
  onNavigate: (partIndex: number, time: number) => void,
  partMap: (number | null)[],
) {
  const pattern = /\[(?:P(\d+)-)?(\d{1,3}):(\d{2})(?::(\d{2}))?\]/gi
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const target = parseTimestamp(match)
    const currentPart = partMap[target.partIndex] ?? null
    nodes.push(
      <button
        key={lineIndex + ':' + match.index}
        className="timestamp-button"
        type="button"
        disabled={currentPart === null}
        title={currentPart === null ? t('无法确定这个时间戳对应的视频', 'The video for this timestamp could not be identified') : t(`跳转至当前播放列表 P${currentPart + 1}`, `Go to P${currentPart + 1} in the current playlist`)}
        onClick={() => currentPart !== null && onNavigate(currentPart, target.time)}
      >
        {target.label}
      </button>,
    )
    cursor = pattern.lastIndex
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function GuideDocument({ content, onNavigate, partMap }: Pick<GuidePanelProps, 'content' | 'onNavigate'> & { partMap: (number | null)[] }) {
  return (
    <article className="guide-document">
      {content.split(/\r?\n/).map((line, index) => {
        if (!line.trim()) return <div className="guide-spacer" key={index} />
        const heading = line.match(/^(#{1,3})\s+(.+)$/)
        if (heading) {
          const children = renderTextWithTimestamps(heading[2], index, onNavigate, partMap)
          if (heading[1].length === 1) return <h1 key={index}>{children}</h1>
          if (heading[1].length === 2) return <h2 key={index}>{children}</h2>
          return <h3 key={index}>{children}</h3>
        }
        const bullet = line.match(/^\s*[-*]\s+(.+)$/)
        if (bullet) {
          return <div className="guide-bullet" key={index}><span>•</span><p>{renderTextWithTimestamps(bullet[1], index, onNavigate, partMap)}</p></div>
        }
        return <p key={index}>{renderTextWithTimestamps(line, index, onNavigate, partMap)}</p>
      })}
    </article>
  )
}

export function GuidePanel({
  versions,
  activeVersion,
  content,
  isLoading,
  error,
  missingSubtitleNames,
  isGenerating,
  providerLabel,
  generationMessage,
  guideLanguage = 'source',
  onGuideLanguageChange,
  playlist,
  onSelectVersion,
  onContentChange,
  onGenerate,
  onCancel,
  onOpenSettings,
  onNavigate,
}: GuidePanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const canGenerate = missingSubtitleNames.length === 0
  const usesChatGpt = providerLabel.startsWith('ChatGPT')
  const generateLabel = usesChatGpt ? t('用 ChatGPT 生成', 'Generate with ChatGPT') : t('用 API 生成', 'Generate with API')
  const filenameKey = playlist?.items.map((item) => item.name).join('\0') || ''
  const navigation = useMemo(
    () => buildGuideNavigation(content, filenameKey ? filenameKey.split('\0') : []),
    [content, filenameKey],
  )
  const missingSummary = missingSubtitleNames.length > 3
    ? t(`${missingSubtitleNames.slice(0, 3).join('、')} 等 ${missingSubtitleNames.length} 个视频`, `${missingSubtitleNames.slice(0, 3).join(', ')} and ${missingSubtitleNames.length - 3} more`)
    : missingSubtitleNames.join(t('、', ', '))

  return (
    <section className="drawer-panel guide-panel">
      <div className="panel-toolbar guide-toolbar">
        <div>
          <strong>{t('内容导读', 'Content guide')}</strong>
          <span className="guide-provider-label">{translateMessage(providerLabel)}</span>
        </div>
        <div className="panel-toolbar-actions">
          <button className="icon-button" type="button" title={t('导读模型设置', 'Guide model settings')} onClick={onOpenSettings}>
            <Icon name="settings" size={17} />
          </button>
          <button
            className="button-primary compact"
            type="button"
            disabled={!canGenerate || isGenerating}
            title={generateLabel}
            onClick={onGenerate}
          >
            {isGenerating ? t('生成中…', 'Generating…') : activeVersion ? t('生成新版本', 'New version') : t(generateLabel, 'Generate')}
          </button>
        </div>
        <label className="guide-language-control">
          <span>{t('输出语言', 'Guide language')}</span>
          <select
            value={guideLanguage}
            disabled={isGenerating || !onGuideLanguageChange}
            aria-label={t('导读输出语言', 'Guide output language')}
            onChange={(event) => onGuideLanguageChange?.(event.target.value as 'zh-CN' | 'en' | 'source')}
          >
            <option value="source">{t('跟随字幕语言', 'Match subtitles')}</option>
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      {versions.length > 0 && (
        <div className="guide-version-row">
          <label>
            <span>{t('当前版本', 'Version')}</span>
            <select value={activeVersion?.path || ''} onChange={(event) => onSelectVersion(event.target.value)}>
              {versions.map((version) => (
                <option key={version.path} value={version.path}>{version.displayName}</option>
              ))}
            </select>
          </label>
          <button className="text-button" type="button" onClick={() => setIsEditing((value) => !value)}>
            {isEditing ? t('完成编辑', 'Done editing') : t('编辑', 'Edit')}
          </button>
        </div>
      )}

      {missingSubtitleNames.length > 0 && (
        <div className="guide-blocker">
          <strong>{t('字幕还没有齐', 'Some subtitles are missing')}</strong>
          <span>{t(`缺少：${missingSummary}。补齐后才能生成完整导读。`, `Missing: ${missingSummary}. Add subtitles for every video to generate a complete guide.`)}</span>
        </div>
      )}
      {isGenerating && (
        <div className="guide-task-status">
          <span className="loading-ring" />
          <span>{generationMessage ? translateMessage(generationMessage) : t('正在生成导读', 'Generating guide')}</span>
          <button className="text-button" type="button" onClick={onCancel}>{t('取消', 'Cancel')}</button>
        </div>
      )}
      {navigation.warning && (
        <div className="guide-blocker"><span>{translateMessage(navigation.warning)}</span></div>
      )}
      {error && (
        <div className="inline-error guide-error">
          <span>{translateMessage(error)}</span>
          <button className="text-button" type="button" onClick={onOpenSettings}>{t('查看设置', 'Open settings')}</button>
        </div>
      )}

      <div className="guide-content">
        {isLoading ? (
          <div className="panel-empty"><span className="loading-ring" /><strong>{t('正在读取导读', 'Loading guide')}</strong></div>
        ) : content ? (
          isEditing ? (
            <textarea
              className="guide-editor"
              aria-label={t('编辑导读正文', 'Edit guide text')}
              value={navigation.body}
              spellCheck={false}
              onChange={(event) => onContentChange(event.target.value)}
            />
          ) : (
            <GuideDocument content={navigation.body} onNavigate={onNavigate} partMap={navigation.partMap} />
          )
        ) : (
          <div className="panel-empty guide-empty">
            <Icon name="guide" size={24} />
            <strong>{t('还没有内容导读', 'No guide yet')}</strong>
            <span>{t('它会忠实列出字幕里出现的话题，并把时间戳放在话题真正开始的位置。', 'Explore the topics covered in your subtitles, with timestamps that take you to where each topic begins.')}</span>
            <button className="button-primary" type="button" disabled={!canGenerate || isGenerating} onClick={onGenerate}>
              {isGenerating ? t('生成中…', 'Generating…') : generateLabel}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
