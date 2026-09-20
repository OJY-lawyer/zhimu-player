import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlayerPlaylistItem, SubtitleStyle } from '../playerTypes'
import { findNearestSubtitle, findSubtitleIndex, formatTime } from '../utils/srtParser'
import { useVideo } from '../hooks/useVideo'
import { Icon } from './Icons'
import { t, translateMessage } from '../i18n'
import { APP_TAGLINE_ZH, APP_TAGLINE_EN } from '../../shared/brand'

interface VideoPlayerProps {
  item: PlayerPlaylistItem | null
  initialVolume: number
  initialMuted: boolean
  playbackRate: number
  subtitleStyle: SubtitleStyle
  seekRequest?: { itemId: string; time: number; token: number } | null
  canGoPrevious: boolean
  canGoNext: boolean
  autoplayNext: boolean
  isFullscreen: boolean
  searchOpen: boolean
  onOpenVideo: () => void
  onOpenFolder: () => void
  onDropMedia: (droppedPath: string) => void
  onTimeUpdate: (time: number, duration: number) => void
  onLoadedMetadata: (duration: number) => void
  onPlaybackRateChange: (rate: number) => void
  onVolumeChange: (volume: number) => void
  onMutedChange: (muted: boolean) => void
  onSubtitleStyleChange: (style: SubtitleStyle) => void
  onSubtitleOffsetChange: (offset: number) => void
  onPrevious: () => void
  onNext: () => void
  onEnded: () => void
  onToggleFullscreen: () => void
  onExitFullscreen: () => void
  onOpenSearch: () => void
  onPersist: () => void
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]')
}

export function VideoPlayer({
  item,
  initialVolume,
  initialMuted,
  playbackRate,
  subtitleStyle,
  seekRequest,
  canGoPrevious,
  canGoNext,
  autoplayNext,
  isFullscreen,
  searchOpen,
  onOpenVideo,
  onOpenFolder,
  onDropMedia,
  onTimeUpdate,
  onLoadedMetadata,
  onPlaybackRateChange,
  onVolumeChange,
  onMutedChange,
  onSubtitleStyleChange,
  onSubtitleOffsetChange,
  onPrevious,
  onNext,
  onEnded,
  onToggleFullscreen,
  onExitFullscreen,
  onOpenSearch,
  onPersist,
}: VideoPlayerProps) {
  const video = useVideo()
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [showSubtitleSettings, setShowSubtitleSettings] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [resumeNoticeVisible, setResumeNoticeVisible] = useState(false)
  const [progressPreview, setProgressPreview] = useState<{ ratio: number; time: number } | null>(null)
  const controlsTimerRef = useRef<number | null>(null)
  const singleClickTimerRef = useRef<number | null>(null)
  const continuePlaybackRef = useRef(false)
  const stageRef = useRef<HTMLElement | null>(null)

  const subtitles = item?.subtitles || []
  const subtitleOffset = item?.subtitleOffset || 0
  const adjustedTime = video.currentTime + subtitleOffset
  const currentSubtitleIndex = useMemo(
    () => findSubtitleIndex(subtitles, adjustedTime),
    [adjustedTime, subtitles],
  )
  const currentSubtitle = currentSubtitleIndex >= 0 ? subtitles[currentSubtitleIndex] : null

  const clearControlsTimer = useCallback(() => {
    if (controlsTimerRef.current !== null) {
      window.clearTimeout(controlsTimerRef.current)
      controlsTimerRef.current = null
    }
  }, [])

  const wakeControls = useCallback(() => {
    clearControlsTimer()
    setControlsVisible(true)
    if (video.isPlaying && !showSubtitleSettings && !isScrubbing) {
      controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2000)
    }
  }, [clearControlsTimer, isScrubbing, showSubtitleSettings, video.isPlaying])

  useEffect(() => {
    wakeControls()
    return clearControlsTimer
  }, [wakeControls, clearControlsTimer])

  useEffect(() => {
    setMediaError(null)
    setProgressPreview(null)
  }, [item?.id])

  useEffect(() => {
    if (seekRequest && seekRequest.itemId === item?.id && (video.videoRef.current?.readyState || 0) >= 1) {
      video.seek(seekRequest.time)
    }
  }, [item?.id, seekRequest, video.seek, video.videoRef])

  useEffect(() => () => {
    if (singleClickTimerRef.current !== null) window.clearTimeout(singleClickTimerRef.current)
  }, [])

  const adjustVolume = useCallback((delta: number) => {
    const element = video.videoRef.current
    if (!element) return
    // Muting preserves the chosen level. A volume gesture resumes from that level instead of
    // unexpectedly dropping to 5%, while scrolling up from zero starts at 5%.
    const current = element.volume
    const next = Math.max(0, Math.min(1, current + delta))
    video.setVolumeValue(next)
    onVolumeChange(next)
    onMutedChange(next === 0)
    wakeControls()
  }, [onMutedChange, onVolumeChange, video.setVolumeValue, video.videoRef, wakeControls])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const handleWheel = (event: WheelEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !event.deltaY) return
      if (target !== video.videoRef.current && !target.closest('.volume-control')) return
      event.preventDefault()
      event.stopPropagation()
      adjustVolume(event.deltaY > 0 ? -0.05 : 0.05)
    }
    // React's delegated wheel listener is passive. A native listener is required to consume
    // wheel gestures over the volume button/slider without also scrolling a containing panel.
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [adjustVolume, video.videoRef])

  const toggleMute = useCallback(() => {
    const element = video.videoRef.current
    if (!element) return
    const willMute = !element.muted && element.volume > 0
    video.toggleMute()
    onMutedChange(willMute)
    if (!willMute) onVolumeChange(element.volume || initialVolume || 1)
    wakeControls()
  }, [initialVolume, onMutedChange, onVolumeChange, video, wakeControls])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        onOpenSearch()
        return
      }
      if (isEditableTarget(event.target)) return

      const key = event.key.toLocaleLowerCase()
      if (event.code === 'Space') {
        event.preventDefault()
        video.togglePlay()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const amount = event.shiftKey ? 30 : event.ctrlKey ? 10 : 1
        video.seekBy(event.key === 'ArrowLeft' ? -amount : amount)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        adjustVolume(event.key === 'ArrowUp' ? 0.05 : -0.05)
      } else if (key === 'm') {
        event.preventDefault()
        toggleMute()
      } else if (key === 'f') {
        event.preventDefault()
        onToggleFullscreen()
      } else if (key === 's') {
        event.preventDefault()
        onSubtitleStyleChange({ ...subtitleStyle, visible: !subtitleStyle.visible })
      } else if (event.key === 'Escape' && isFullscreen && !searchOpen) {
        event.preventDefault()
        onExitFullscreen()
      }
      wakeControls()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    adjustVolume,
    isFullscreen,
    searchOpen,
    onExitFullscreen,
    onOpenSearch,
    onSubtitleStyleChange,
    onToggleFullscreen,
    subtitleStyle,
    toggleMute,
    video,
    wakeControls,
  ])

  const handleSurfaceClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('.player-controls, .player-popover, button, input, select')) return
    if (singleClickTimerRef.current !== null) window.clearTimeout(singleClickTimerRef.current)
    singleClickTimerRef.current = window.setTimeout(() => {
      video.togglePlay()
      singleClickTimerRef.current = null
    }, 190)
  }, [video])

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    if (target.closest('.player-controls, .player-popover, button, input, select')) return
    if (singleClickTimerRef.current !== null) {
      window.clearTimeout(singleClickTimerRef.current)
      singleClickTimerRef.current = null
    }
    onToggleFullscreen()
  }, [onToggleFullscreen])

  const handleLoadedMetadata = useCallback(() => {
    const element = video.videoRef.current
    if (!element || !item) return
    video.setDuration(element.duration)
    video.setCurrentTime(element.currentTime)
    video.setIsPlaying(!element.paused)
    video.setVolumeValue(initialVolume)
    video.setMutedValue(initialMuted)
    video.changePlaybackRate(playbackRate)
    const requestedTime = seekRequest?.itemId === item.id ? seekRequest.time : null
    const resumeTime = requestedTime === null
      ? Math.max(0, Math.min(element.duration || item.lastPosition, item.lastPosition))
      : Math.max(0, Math.min(element.duration, requestedTime))
    if (requestedTime !== null || resumeTime > 1) {
      video.seek(resumeTime)
      if (requestedTime === null && resumeTime > 1) {
        setResumeNoticeVisible(true)
        window.setTimeout(() => setResumeNoticeVisible(false), 6000)
      }
    }
    onLoadedMetadata(element.duration)
    if (continuePlaybackRef.current) {
      continuePlaybackRef.current = false
      void element.play()
    }
  }, [initialMuted, initialVolume, item, onLoadedMetadata, playbackRate, seekRequest, video])

  const handleTimeUpdate = useCallback(() => {
    const element = video.videoRef.current
    if (!element) return
    video.setCurrentTime(element.currentTime)
    onTimeUpdate(element.currentTime, element.duration || video.duration)
  }, [onTimeUpdate, video])

  const handleEnded = useCallback(() => {
    continuePlaybackRef.current = canGoNext && autoplayNext
    onEnded()
    onPersist()
  }, [autoplayNext, canGoNext, onEnded, onPersist])

  const handleProgressMove = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    if (!video.duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    setProgressPreview({ ratio, time: ratio * video.duration })
  }, [video.duration])

  const previewSubtitle = progressPreview
    ? findNearestSubtitle(subtitles, progressPreview.time + subtitleOffset)
    : null
  const progressRatio = video.duration > 0 ? video.currentTime / video.duration : 0

  return (
    <section
      ref={stageRef}
      className={'video-stage ' + (controlsVisible ? 'controls-visible ' : '') + (isDraggingFile ? 'is-dragging' : '')}
      onMouseMove={wakeControls}
      onDragOver={(event) => {
        event.preventDefault()
        setIsDraggingFile(true)
      }}
      onDragLeave={() => setIsDraggingFile(false)}
      onDrop={(event) => {
        event.preventDefault()
        setIsDraggingFile(false)
        const file = event.dataTransfer.files[0]
        const droppedPath = file ? window.electronAPI.getPathForFile(file) : ''
        if (droppedPath) onDropMedia(droppedPath)
      }}
      onClick={handleSurfaceClick}
      onDoubleClick={handleDoubleClick}
    >
      {!item ? (
        <div className="video-empty">
          <div className="video-empty-mark"><Icon name="play" size={26} /></div>
          <h1>{mediaError ? t('无法播放这个文件', 'This file cannot be played') : t(APP_TAGLINE_ZH, APP_TAGLINE_EN)}</h1>
          <p>{mediaError ? translateMessage(mediaError) : t('单个视频和整套直播录像使用同一套播放列表。', 'One workspace for a single video or an entire recording series.')}</p>
          <div className="video-empty-actions">
            <button className="button-primary" type="button" onClick={onOpenFolder}>
              <Icon name="folder" size={17} />{t('打开文件夹', 'Open folder')}
            </button>
            <button className="button-secondary" type="button" onClick={onOpenVideo}>{t('打开单个视频', 'Open video')}</button>
          </div>
          <span className="video-empty-hint">{t('也可以把视频或文件夹直接拖到窗口中', 'Or drop a video or folder here')}</span>
        </div>
      ) : (
        <>
          <video
            key={item.id}
            ref={(element) => { video.videoRef.current = element }}
            src={item.url}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => video.setIsPlaying(true)}
            onPause={() => {
              video.setIsPlaying(false)
              onPersist()
            }}
            onEnded={handleEnded}
            onError={() => setMediaError('当前播放器无法解码这个视频的容器或编码。视频文件本身没有被修改。')}
          />

          {mediaError && (
            <div className="media-error" role="alert">
              <strong>{t('无法解码当前视频', 'Unsupported video format')}</strong>
              <span>{translateMessage(mediaError)}</span>
              <button type="button" onClick={onOpenVideo}>{t('选择其他视频', 'Choose another video')}</button>
            </div>
          )}

          {subtitleStyle.visible && currentSubtitle && (
            <div
              className="subtitle-overlay"
              style={{
                bottom: subtitleStyle.verticalPosition + '%',
                fontSize: subtitleStyle.size + 'px',
                backgroundColor: 'rgba(12, 10, 9, ' + subtitleStyle.backgroundOpacity + ')',
              }}
            >
              {currentSubtitle.text}
            </div>
          )}

          {resumeNoticeVisible && (
            <div className="player-toast">
              <span>{t(`已恢复至 ${formatTime(item.lastPosition)}`, `Resumed at ${formatTime(item.lastPosition)}`)}</span>
              <button type="button" onClick={() => {
                video.seek(0)
                setResumeNoticeVisible(false)
              }}>{t('从头播放', 'Play from start')}</button>
            </div>
          )}

          {isDraggingFile && (
            <div className="drag-overlay"><Icon name="folder" size={24} />{t('松开以打开视频或文件夹', 'Drop to open video or folder')}</div>
          )}

          <div className="player-control-scrim" aria-hidden="true" />
          <div className="player-controls" onMouseEnter={wakeControls}>
            <div className="progress-wrap">
              {progressPreview && (
                <div
                  className="progress-preview"
                  style={{ left: (progressPreview.ratio * 100) + '%' }}
                >
                  <strong>{formatTime(progressPreview.time)}</strong>
                  {previewSubtitle && <span>{previewSubtitle.text}</span>}
                </div>
              )}
              <input
                className="progress-bar"
                type="range"
                min="0"
                max={video.duration || 0}
                step="0.01"
                value={video.currentTime}
                style={{ '--progress': (progressRatio * 100) + '%' } as React.CSSProperties}
                aria-label={t('播放进度', 'Playback position')}
                onMouseMove={handleProgressMove}
                onMouseLeave={() => setProgressPreview(null)}
                onMouseDown={() => setIsScrubbing(true)}
                onMouseUp={() => setIsScrubbing(false)}
                onChange={(event) => video.seek(Number(event.target.value))}
              />
            </div>

            <div className="controls-row">
              <div className="controls-group">
                <button className="icon-button" type="button" disabled={!canGoPrevious} title={t('上一 Part', 'Previous part')} onClick={onPrevious}>
                  <Icon name="chevron-left" />
                </button>
                <button className="play-button" type="button" title={video.isPlaying ? t('暂停', 'Pause') : t('播放', 'Play')} onClick={video.togglePlay}>
                  <Icon name={video.isPlaying ? 'pause' : 'play'} size={21} />
                </button>
                <button className="icon-button" type="button" disabled={!canGoNext} title={t('下一 Part', 'Next part')} onClick={onNext}>
                  <Icon name="chevron-right" />
                </button>
                <span className="time-display">{formatTime(video.currentTime)} <i>/</i> {formatTime(video.duration)}</span>
              </div>

              <div className="controls-group controls-secondary">
                <div className="volume-control">
                  <button className="icon-button" type="button" title={video.isMuted ? t('取消静音', 'Unmute') : t('静音', 'Mute')} onClick={toggleMute}>
                    <Icon name={video.isMuted ? 'volume-off' : 'volume'} />
                  </button>
                  <input
                    className="volume-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={video.isMuted ? 0 : video.volume}
                    aria-label={t('音量', 'Volume')}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      video.setVolumeValue(value)
                      onVolumeChange(value)
                      onMutedChange(value === 0)
                    }}
                  />
                </div>

                <select
                  className="speed-selector"
                  value={video.playbackRate}
                  aria-label={t('播放速度', 'Playback speed')}
                  onChange={(event) => {
                    const rate = Number(event.target.value)
                    video.changePlaybackRate(rate)
                    onPlaybackRateChange(rate)
                  }}
                >
                  {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
                </select>

                <button className="icon-button" type="button" title={t('搜索字幕与导读', 'Search subtitles and guide')} onClick={onOpenSearch}>
                  <Icon name="search" />
                </button>
                <div className="popover-anchor">
                  <button
                    className={'icon-button ' + (showSubtitleSettings ? 'is-active' : '')}
                    type="button"
                    title={t('字幕显示设置', 'Subtitle display settings')}
                    onClick={() => setShowSubtitleSettings((visible) => !visible)}
                  >
                    <Icon name="settings" />
                  </button>
                  {showSubtitleSettings && (
                    <div className="player-popover subtitle-settings-popover">
                      <div className="popover-heading">
                        <strong>{t('字幕显示', 'Subtitle display')}</strong>
                        <label className="switch">
                          <input
                            type="checkbox"
                            aria-label={t('显示字幕', 'Show subtitles')}
                            checked={subtitleStyle.visible}
                            onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, visible: event.target.checked })}
                          />
                          <span />
                        </label>
                      </div>
                      <label className="setting-row">
                        <span>{t('字号', 'Font size')} <b>{subtitleStyle.size}px</b></span>
                        <input type="range" min="16" max="48" value={subtitleStyle.size} onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, size: Number(event.target.value) })} />
                      </label>
                      <label className="setting-row">
                        <span>{t('垂直位置', 'Vertical position')} <b>{subtitleStyle.verticalPosition}%</b></span>
                        <input type="range" min="4" max="35" value={subtitleStyle.verticalPosition} onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, verticalPosition: Number(event.target.value) })} />
                      </label>
                      <label className="setting-row">
                        <span>{t('背景透明度', 'Background opacity')} <b>{Math.round(subtitleStyle.backgroundOpacity * 100)}%</b></span>
                        <input type="range" min="0" max="0.9" step="0.05" value={subtitleStyle.backgroundOpacity} onChange={(event) => onSubtitleStyleChange({ ...subtitleStyle, backgroundOpacity: Number(event.target.value) })} />
                      </label>
                      <div className="offset-setting">
                        <span>{t('时间偏移', 'Timing offset')}</span>
                        <div>
                          <button type="button" onClick={() => onSubtitleOffsetChange(Number((subtitleOffset - 0.5).toFixed(1)))}>−0.5s</button>
                          <b>{subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(1)}s</b>
                          <button type="button" onClick={() => onSubtitleOffsetChange(Number((subtitleOffset + 0.5).toFixed(1)))}>+0.5s</button>
                          <button type="button" onClick={() => onSubtitleOffsetChange(0)}>{t('重置', 'Reset')}</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <button className="icon-button" type="button" title={isFullscreen ? t('退出全屏', 'Exit fullscreen') : t('全屏', 'Fullscreen')} onClick={onToggleFullscreen}>
                  <Icon name="fullscreen" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
