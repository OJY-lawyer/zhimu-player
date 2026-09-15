import { useCallback, useEffect, useState } from 'react'
import type { WindowState } from '../shared/contracts'
import { SetupDialog } from './components/SetupDialog'
import { AboutPanel } from './components/AboutPanel'
import { GuidePanel } from './components/GuidePanel'
import { PlaylistPanel } from './components/PlaylistPanel'
import { RightDrawer } from './components/RightDrawer'
import { SearchOverlay, type SearchResult } from './components/SearchOverlay'
import { SubtitleBrowser } from './components/SubtitleBrowser'
import { TitleBar } from './components/TitleBar'
import { VideoPlayer } from './components/VideoPlayer'
import { useDrawerState } from './hooks/useDrawerState'
import { useAsrTranscription } from './hooks/useAsrTranscription'
import { useGuideGeneration } from './hooks/useGuideGeneration'
import { useGuideLibrary } from './hooks/useGuideLibrary'
import { usePlayerSession } from './hooks/usePlayerSession'
import { initializeLanguage, useI18n } from './i18n'
import { APP_NAME_ZH, APP_NAME_EN } from '../shared/brand'

const EMPTY_WINDOW_STATE: WindowState = {
  isFullscreen: false,
  isMaximized: false,
  isAlwaysOnTop: false,
}

export default function App() {
  const { t, translateMessage } = useI18n()
  useEffect(() => { void initializeLanguage().catch(() => {}) }, [])
  const session = usePlayerSession()
  const drawer = useDrawerState(
    session.playlist?.id || 'empty',
    session.drawerPreferences,
    session.activeDrawerTab,
  )
  const guide = useGuideLibrary(session.playlist, session.playlist?.activeGuidePath)
  const guideGeneration = useGuideGeneration(session.playlist, guide.createVersion)
  const asr = useAsrTranscription(session.playlist, session.reloadPlaylist, guideGeneration.config.asrLanguage)
  const [showAbout, setShowAbout] = useState(false)
  const [restartSetup, setRestartSetup] = useState(false)
  const [closeError, setCloseError] = useState('')
  const firstRun = guideGeneration.configReady && !guideGeneration.config.setupCompleted
  useEffect(() => window.electronAPI.onPrepareClose(() => {
    void (async () => {
      try {
        if (!await guide.flushDirty()) { setCloseError('导读修改尚未保存，请检查目录权限后再关闭。'); await window.electronAPI.completeClose(false); return }
        await session.persistNow()
        await window.electronAPI.completeClose(true)
      } catch { setCloseError('保存播放状态失败，窗口已保留。'); await window.electronAPI.completeClose(false) }
    })()
  }), [guide.flushDirty, session.persistNow])
  const [windowState, setWindowState] = useState<WindowState>(EMPTY_WINDOW_STATE)
  const [currentTime, setCurrentTime] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [seekRequest, setSeekRequest] = useState<{ itemId: string; time: number; token: number } | null>(null)

  useEffect(() => {
    void window.electronAPI.getWindowState().then(setWindowState)
    return window.electronAPI.onWindowStateChanged(setWindowState)
  }, [])

  useEffect(() => {
    session.setDrawerPreferences(drawer.isPinned, drawer.width)
  }, [drawer.isPinned, drawer.width, session.setDrawerPreferences])

  useEffect(() => {
    session.setActiveDrawerTab(drawer.activeTab)
  }, [drawer.activeTab, session.setActiveDrawerTab])

  useEffect(() => {
    setCurrentTime(0)
  }, [session.activeItem?.id])

  useEffect(() => {
    const path = guide.activeVersion?.path
    if (!session.playlist || guide.ownerPlaylistId !== session.playlist.id) return
    if (path && path !== session.playlist.activeGuidePath) session.setActiveGuidePath(path)
  }, [guide.activeVersion?.path, guide.ownerPlaylistId, session.playlist?.id, session.playlist?.activeGuidePath, session.setActiveGuidePath])

  const navigate = useCallback((partIndex: number, time: number, tab?: 'subtitles' | 'guide') => {
    const item = session.playlist?.items[partIndex]
    if (!item) return
    setSeekRequest({ itemId: item.id, time, token: Date.now() + Math.random() })
    session.selectItem(partIndex)
    if (tab) drawer.openTab(tab)
  }, [drawer, session])

  const handleSearchNavigate = useCallback((result: SearchResult) => {
    navigate(result.partIndex, result.time, result.source === 'guide' ? 'guide' : 'subtitles')
  }, [navigate])

  const closeSearch = useCallback(() => setSearchOpen(false), [])

  const handleManualSelect = useCallback((index: number, fromStart = false) => {
    const item = session.playlist?.items[index]
    if (fromStart && item) {
      setSeekRequest({ itemId: item.id, time: 0, token: Date.now() + Math.random() })
    } else {
      setSeekRequest(null)
    }
    session.selectItem(index, fromStart)
  }, [session])

  const handleExportSubtitles = useCallback(() => {
    const item = session.activeItem
    if (!item || item.subtitles.length === 0) return
    const content = item.subtitles.map((subtitle) => subtitle.text).join('\n')
    void window.electronAPI.saveFile({
      defaultPath: item.stem + t('_字幕.md', '_subtitles.md'),
      content,
    })
  }, [session.activeItem])

  const handleToggleFullscreen = useCallback(async () => {
    setWindowState(await window.electronAPI.toggleFullscreen())
  }, [])

  const handleExitFullscreen = useCallback(async () => {
    setWindowState(await window.electronAPI.exitFullscreen())
  }, [])

  const handleToggleAlwaysOnTop = useCallback(async () => {
    const next = await window.electronAPI.toggleAlwaysOnTop()
    setWindowState(next)
    session.setAlwaysOnTopPreference(next.isAlwaysOnTop)
    void session.persistNow()
  }, [session])

  const missingSubtitleNames = session.playlist?.items
    .filter((item) => item.subtitles.length === 0)
    .map((item) => item.stem) || []
  const currentIndex = session.playlist?.currentIndex || 0
  const activeItem = session.activeItem
  const partLabel = activeItem && session.playlist
    ? 'P' + (currentIndex + 1) + ' · ' + activeItem.stem
    : undefined

  return (
    <div
      className={'app-shell ' + (windowState.isFullscreen ? 'is-fullscreen ' : '') + (drawer.isPinned ? 'has-pinned-drawer' : '')}
      style={{ '--drawer-width': drawer.width + 'px' } as React.CSSProperties}
    >
      {!windowState.isFullscreen && (
        <TitleBar
          title={session.playlist?.displayName || t(APP_NAME_ZH, APP_NAME_EN)}
          subtitle={partLabel}
          isAlwaysOnTop={windowState.isAlwaysOnTop}
          onToggleAlwaysOnTop={() => void handleToggleAlwaysOnTop()}
          onOpenSettings={() => guideGeneration.setShowConfig(true)}
        />
      )}

      <main className="playback-workspace">
        <VideoPlayer
          item={activeItem}
          initialVolume={session.volume}
          initialMuted={session.muted}
          playbackRate={session.playlist?.playbackRate || 1}
          subtitleStyle={session.subtitleStyle}
          seekRequest={seekRequest}
          canGoPrevious={currentIndex > 0}
          canGoNext={Boolean(session.playlist && currentIndex < session.playlist.items.length - 1)}
          autoplayNext={session.autoplayNext}
          isFullscreen={windowState.isFullscreen}
          searchOpen={searchOpen || guideGeneration.showConfig || firstRun || restartSetup || showAbout}
          onOpenVideo={() => void session.openVideo()}
          onOpenFolder={() => void session.openFolder()}
          onDropMedia={(droppedPath) => void session.openDroppedMedia(droppedPath)}
          onTimeUpdate={(time, duration) => {
            setCurrentTime(time)
            session.updateProgress(time, duration)
          }}
          onLoadedMetadata={(duration) => {
            session.updateProgress(activeItem?.lastPosition || 0, duration)
          }}
          onPlaybackRateChange={session.setPlaybackRate}
          onVolumeChange={session.setVolume}
          onMutedChange={session.setMuted}
          onSubtitleStyleChange={session.setSubtitleStyle}
          onSubtitleOffsetChange={session.setCurrentSubtitleOffset}
          onPrevious={() => handleManualSelect(currentIndex - 1)}
          onNext={() => handleManualSelect(currentIndex + 1)}
          onEnded={() => {
            setSeekRequest(null)
            session.advanceToNext()
          }}
          onToggleFullscreen={() => void handleToggleFullscreen()}
          onExitFullscreen={() => void handleExitFullscreen()}
          onOpenSearch={() => setSearchOpen(true)}
          onPersist={() => void session.persistNow()}
        />

        <RightDrawer
          activeTab={drawer.activeTab}
          isOpen={drawer.isOpen}
          isPinned={drawer.isPinned}
          isResizing={drawer.isResizing}
          width={drawer.width}
          playlistCount={session.playlist?.items.length || 0}
          subtitleCount={activeItem?.subtitles.length || 0}
          onActiveTabChange={drawer.setActiveTab}
          onPinToggle={drawer.togglePinned}
          onEdgeEnter={drawer.handleEdgeEnter}
          onDrawerEnter={drawer.handleDrawerEnter}
          onDrawerLeave={drawer.handleDrawerLeave}
          onResizeMouseDown={drawer.handleResizeMouseDown}
        >
          {drawer.activeTab === 'playlist' && (
            <PlaylistPanel
              playlist={session.playlist}
              autoplayNext={session.autoplayNext}
              onAutoplayNextChange={session.setAutoplayNext}
              onOpenFolder={() => void session.openFolder()}
              onOpenVideo={() => void session.openVideo()}
              onSelectItem={handleManualSelect}
              onReorder={session.reorder}
              onNaturalSort={session.naturalSort}
              onCompletedChange={session.setCompleted}
              missingSubtitleCount={asr.missingCount}
              asrRunning={asr.isRunning}
              asrMessage={asr.progress.message}
              asrPercent={asr.progress.percent}
              asrError={asr.error}
              onGenerateMissingSubtitles={() => void asr.generateMissing()}
              onCancelAsr={() => void asr.cancel()}
            />
          )}
          {drawer.activeTab === 'subtitles' && (
            <SubtitleBrowser
              key={activeItem?.id || 'empty-subtitles'}
              subtitles={activeItem?.subtitles || []}
              currentTime={currentTime}
              subtitleOffset={activeItem?.subtitleOffset || 0}
              subtitleSource={activeItem?.subtitleSource || 'none'}
              onSeek={(time) => activeItem && navigate(currentIndex, Math.max(0, time - activeItem.subtitleOffset))}
              onExport={handleExportSubtitles}
              onSaveRevision={session.saveSubtitleRevision}
            />
          )}
          {drawer.activeTab === 'guide' && (
            <GuidePanel
              guideLanguage={guideGeneration.config.guideLanguage}
              onGuideLanguageChange={(language) => void guideGeneration.saveLanguage(language)}
              playlist={session.playlist}
              versions={guide.versions}
              activeVersion={guide.activeVersion}
              content={guide.content}
              isLoading={guide.isLoading}
              error={guide.error || guideGeneration.error}
              missingSubtitleNames={missingSubtitleNames}
              isGenerating={guideGeneration.isGenerating}
              providerLabel={guideGeneration.providerLabel}
              generationMessage={guideGeneration.progress?.message}
              onSelectVersion={(path) => {
                void guide.selectVersion(path)
              }}
              onContentChange={guide.updateContent}
              onGenerate={() => void guideGeneration.generate()}
              onCancel={() => void guideGeneration.cancel()}
              onOpenSettings={() => guideGeneration.setShowConfig(true)}
              onNavigate={(partIndex, time) => navigate(partIndex, time, 'guide')}
            />
          )}
        </RightDrawer>

        <SearchOverlay
          open={searchOpen}
          playlist={session.playlist}
          guideText={guide.content}
          onClose={closeSearch}
          onNavigate={handleSearchNavigate}
        />

        {session.isRestoring && (
          <div className="restore-overlay">
            <span className="loading-ring" />
            <span>{t('正在恢复上次播放位置', 'Restoring playback position')}</span>
          </div>
        )}
        {closeError && <div className="app-notice is-error" role="alert">{translateMessage(closeError)}</div>}
        {session.error && <div className="app-notice is-error">{translateMessage(session.error)}</div>}
      </main>

      {(guideGeneration.showConfig || firstRun || restartSetup) && (
        <SetupDialog
          key={firstRun || restartSetup ? 'setup' : 'settings'}
          config={guideGeneration.config}
          onboarding={firstRun || restartSetup}
          onSave={guideGeneration.saveConfig}
          onAbout={() => setShowAbout(true)}
          onRestartSetup={() => setRestartSetup(true)}
          onClose={() => { guideGeneration.setShowConfig(false); setRestartSetup(false) }}
        />
      )}
      {showAbout && <AboutPanel onClose={() => setShowAbout(false)} />}
    </div>
  )
}
