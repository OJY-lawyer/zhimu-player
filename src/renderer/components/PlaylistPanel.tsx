import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ActivePlaylist, PlayerPlaylistItem } from '../playerTypes'
import { formatTime } from '../utils/srtParser'
import { Icon } from './Icons'
import { t, translateMessage } from '../i18n'

interface PlaylistPanelProps {
  playlist: ActivePlaylist | null
  autoplayNext: boolean
  onAutoplayNextChange: (enabled: boolean) => void
  onOpenFolder: () => void
  onOpenVideo: () => void
  onSelectItem: (index: number, fromStart?: boolean) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onNaturalSort: () => void
  onCompletedChange: (index: number, completed: boolean) => void
  missingSubtitleCount: number
  asrRunning: boolean
  asrMessage: string
  asrPercent?: number
  asrError: string | null
  onGenerateMissingSubtitles: () => void
  onCancelAsr: () => void
}

interface SortableItemProps {
  item: PlayerPlaylistItem
  index: number
  isActive: boolean
  onSelect: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onCompletedChange: (completed: boolean) => void
}

function SortableItem({
  item,
  index,
  isActive,
  onSelect,
  onContextMenu,
  onCompletedChange,
}: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const progress = item.duration > 0 ? Math.min(100, (item.lastPosition / item.duration) * 100) : 0
  const subtitleText = item.subtitles.length > 0
    ? item.subtitleSource === 'revision' ? t('修订字幕', 'Revised subtitles') : t('有字幕', 'Subtitles ready')
    : t('缺字幕', 'No subtitles')

  return (
    <div
      ref={setNodeRef}
      className={'playlist-item ' + (isActive ? 'is-active ' : '') + (isDragging ? 'is-dragging' : '')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <button
        className="drag-handle"
        type="button"
        title={t('拖动排序', 'Drag to reorder')}
        aria-label={t(`拖动 P${index + 1}`, `Drag P${index + 1}`)}
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
      >
        <span />
        <span />
        <span />
      </button>
      <span className="part-index">P{index + 1}</span>
      <div className="playlist-item-main">
        <strong title={item.path}>{item.stem}</strong>
        <div className="playlist-item-meta">
          <span className={item.subtitles.length > 0 ? '' : 'is-warning'}>{subtitleText}</span>
          {item.duration > 0 && <span>{formatTime(item.lastPosition)} / {formatTime(item.duration)}</span>}
          {item.isNew && <span className="new-badge">{t('新增', 'New')}</span>}
        </div>
        <div className="item-progress" aria-hidden="true">
          <span style={{ width: progress + '%' }} />
        </div>
      </div>
      <button
        className={'watched-toggle ' + (item.completed ? 'is-complete' : '')}
        type="button"
        title={item.completed ? t('取消已看完', 'Mark as unwatched') : t('标记为已看完', 'Mark as watched')}
        aria-pressed={item.completed}
        onClick={(event) => {
          event.stopPropagation()
          onCompletedChange(!item.completed)
        }}
      >
        {item.completed ? '✓' : ''}
      </button>
    </div>
  )
}

export function PlaylistPanel({
  playlist,
  autoplayNext,
  onAutoplayNextChange,
  onOpenFolder,
  onOpenVideo,
  onSelectItem,
  onReorder,
  onNaturalSort,
  onCompletedChange,
  missingSubtitleCount,
  asrRunning,
  asrMessage,
  asrPercent,
  asrError,
  onGenerateMissingSubtitles,
  onCancelAsr,
}: PlaylistPanelProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [actionsMenu, setActionsMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const close = () => {
      setMenu(null)
      setActionsMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  const handleDragEnd = (event: DragEndEvent) => {
    if (!playlist || !event.over || event.active.id === event.over.id) return
    const from = playlist.items.findIndex((item) => item.id === event.active.id)
    const to = playlist.items.findIndex((item) => item.id === event.over?.id)
    if (from >= 0 && to >= 0) onReorder(from, to)
  }

  return (
    <section className="drawer-panel playlist-panel">
      <div className="panel-toolbar">
        <div>
          <strong>{playlist?.displayName || t('播放列表', 'Playlist')}</strong>
          <span>{playlist ? t(`${playlist.items.length} 个 Part`, `${playlist.items.length} ${playlist.items.length === 1 ? 'part' : 'parts'}`) : t('尚未打开视频', 'No video open')}</span>
        </div>
        <button
          className="icon-button"
          type="button"
          title={t('播放列表选项', 'Playlist options')}
          aria-label={t('播放列表选项', 'Playlist options')}
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            setActionsMenu((current) => current ? null : { x: rect.right - 180, y: rect.bottom + 5 })
          }}
        >
          <Icon name="more" />
        </button>
      </div>

      {playlist && (missingSubtitleCount > 0 || asrRunning || Boolean(asrError)) && (
        <div className={'asr-task-strip ' + (asrError ? 'is-error' : '')}>
          <div className="asr-task-copy">
            <strong>{asrRunning ? t('字幕任务进行中', 'Generating subtitles') : asrError ? t('字幕任务失败', 'Subtitle generation failed') : t(`缺少 ${missingSubtitleCount} 个字幕`, `${missingSubtitleCount} ${missingSubtitleCount === 1 ? 'video needs' : 'videos need'} subtitles`)}</strong>
            <span>{asrError ? translateMessage(asrError) : asrRunning ? translateMessage(asrMessage) : t('使用通义听悟补齐后即可生成完整导读', 'Use Tingwu to add subtitles, then generate a complete guide.')}</span>
          </div>
          {asrPercent !== undefined && (
            <div className="asr-task-progress">
              <span style={{ width: Math.max(0, Math.min(100, asrPercent)) + '%' }} />
            </div>
          )}
          <button
            className={asrRunning ? 'button-secondary' : 'button-primary'}
            type="button"
            onClick={asrRunning ? onCancelAsr : onGenerateMissingSubtitles}
          >
            {asrRunning ? t('取消', 'Cancel') : t('生成字幕', 'Generate subtitles')}
          </button>
        </div>
      )}

      {playlist ? (
        <div className="playlist-list">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={playlist.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              {playlist.items.map((item, index) => (
                <SortableItem
                  key={item.id}
                  item={item}
                  index={index}
                  isActive={index === playlist.currentIndex}
                  onSelect={() => onSelectItem(index)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({ x: event.clientX, y: event.clientY, index })
                  }}
                  onCompletedChange={(completed) => onCompletedChange(index, completed)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        <div className="panel-empty">
          <Icon name="list" size={22} />
          <strong>{t('播放列表还是空的', 'Your playlist is empty')}</strong>
          <span>{t('一个文件夹会成为一套列表，单视频则是一项列表。', 'Open a folder for a full playlist, or a video for a single-item playlist.')}</span>
        </div>
      )}

      <footer className="playlist-footer">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoplayNext}
            onChange={(event) => onAutoplayNextChange(event.target.checked)}
          />
          <span>{t('播放结束后自动进入下一 Part', 'Play the next part automatically')}</span>
        </label>
      </footer>

      {actionsMenu && createPortal(
        <div
          className="context-menu playlist-actions-menu"
          style={{ left: Math.max(8, actionsMenu.x), top: actionsMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" disabled={!playlist || playlist.items.length < 2} onClick={() => { onNaturalSort(); setActionsMenu(null) }}>{t('按文件名重排', 'Sort by filename')}</button>
          <button type="button" onClick={() => { onOpenVideo(); setActionsMenu(null) }}>{t('打开单个视频', 'Open video')}</button>
          <button type="button" onClick={() => { onOpenFolder(); setActionsMenu(null) }}>{t('打开视频文件夹', 'Open video folder')}</button>
        </div>,
        document.body,
      )}

      {menu && createPortal(
        <div
          className="context-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 170), top: Math.min(menu.y, window.innerHeight - 82) }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => {
            onSelectItem(menu.index, true)
            setMenu(null)
          }}>{t('从头播放', 'Play from start')}</button>
          <button type="button" onClick={() => {
            const completed = playlist?.items[menu.index]?.completed || false
            onCompletedChange(menu.index, !completed)
            setMenu(null)
          }}>{playlist?.items[menu.index]?.completed ? t('取消已看完', 'Mark as unwatched') : t('标记为已看完', 'Mark as watched')}</button>
        </div>,
        document.body,
      )}
    </section>
  )
}
