import type { ReactNode } from 'react'
import { Icon } from './Icons'
import { t } from '../i18n'
import './player-i18n.css'

export type DrawerTab = 'playlist' | 'subtitles' | 'guide'

interface RightDrawerProps {
  activeTab: DrawerTab
  isOpen: boolean
  isPinned: boolean
  isResizing: boolean
  width: number
  playlistCount: number
  subtitleCount: number
  onActiveTabChange: (tab: DrawerTab) => void
  onPinToggle: () => void
  onEdgeEnter: () => void
  onDrawerEnter: () => void
  onDrawerLeave: () => void
  onResizeMouseDown: (event: React.MouseEvent) => void
  children: ReactNode
}

const tabs: { id: DrawerTab; label: string; englishLabel: string; icon: 'list' | 'subtitles' | 'guide' }[] = [
  { id: 'playlist', label: '播放列表', englishLabel: 'Playlist', icon: 'list' },
  { id: 'subtitles', label: '字幕', englishLabel: 'Subtitles', icon: 'subtitles' },
  { id: 'guide', label: '导读', englishLabel: 'Guide', icon: 'guide' },
]

export function RightDrawer({
  activeTab,
  isOpen,
  isPinned,
  isResizing,
  width,
  playlistCount,
  subtitleCount,
  onActiveTabChange,
  onPinToggle,
  onEdgeEnter,
  onDrawerEnter,
  onDrawerLeave,
  onResizeMouseDown,
  children,
}: RightDrawerProps) {
  return (
    <>
      {!isPinned && (
        <div
          className="drawer-edge-trigger"
          aria-hidden="true"
          onMouseEnter={onEdgeEnter}
        />
      )}

      <aside
        className={`right-drawer ${isOpen ? 'is-open' : ''} ${isPinned ? 'is-pinned' : ''} ${isResizing ? 'is-resizing' : ''} ${width < 380 ? 'is-compact' : ''}`}
        style={{ '--drawer-width': `${width}px` } as React.CSSProperties}
        aria-hidden={!isOpen}
        onMouseEnter={onDrawerEnter}
        onMouseLeave={onDrawerLeave}
      >
        <div
          className="drawer-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('调整侧栏宽度', 'Resize sidebar')}
          onMouseDown={onResizeMouseDown}
        />

        <header className="drawer-header">
          <nav className="drawer-tabs" aria-label={t('播放器工作区', 'Player workspace')}>
            {tabs.map((tab) => {
              const count = tab.id === 'playlist'
                ? playlistCount
                : tab.id === 'subtitles'
                  ? subtitleCount
                  : null
              return (
                <button
                  key={tab.id}
                  className={`drawer-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                  type="button"
                  title={t(tab.label, tab.englishLabel) + (count === null ? '' : ` · ${count}`)}
                  aria-selected={activeTab === tab.id}
                  onClick={() => onActiveTabChange(tab.id)}
                >
                  <Icon name={tab.icon} size={16} />
                  <span>{t(tab.label, tab.englishLabel)}</span>
                  {count !== null && <span className="drawer-tab-count">{count}</span>}
                </button>
              )
            })}
          </nav>

          <button
            className={`icon-button drawer-pin ${isPinned ? 'is-active' : ''}`}
            type="button"
            aria-pressed={isPinned}
            title={isPinned ? t('取消固定侧栏', 'Unpin sidebar') : t('固定侧栏', 'Pin sidebar')}
            onClick={onPinToggle}
          >
            <Icon name="pin" size={17} />
          </button>
        </header>

        <div className="drawer-content">{children}</div>
      </aside>
    </>
  )
}
