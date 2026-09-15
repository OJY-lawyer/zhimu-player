import { useCallback, useRef, useState } from 'react'

export function useVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastAudibleVolumeRef = useRef(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => setIsPlaying(false))
    } else {
      video.pause()
    }
  }, [])

  const seek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    const upperBound = Number.isFinite(video.duration) ? video.duration : Math.max(0, time)
    const nextTime = Math.max(0, Math.min(upperBound, time))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video) return
    const upperBound = Number.isFinite(video.duration) ? video.duration : video.currentTime + delta
    const nextTime = Math.max(0, Math.min(upperBound, video.currentTime + delta))
    video.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const setVolumeValue = useCallback((value: number) => {
    const video = videoRef.current
    if (!video) return
    const nextVolume = Math.max(0, Math.min(1, value))
    video.volume = nextVolume
    video.muted = nextVolume === 0
    if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume
    setVolume(nextVolume)
    setIsMuted(video.muted)
  }, [])

  const changeVolume = useCallback((delta: number) => {
    const video = videoRef.current
    if (!video) return
    const baseVolume = video.muted ? 0 : video.volume
    setVolumeValue(baseVolume + delta)
  }, [setVolumeValue])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.muted || video.volume === 0) {
      const restored = Math.max(0.05, lastAudibleVolumeRef.current)
      video.volume = restored
      video.muted = false
      setVolume(restored)
      setIsMuted(false)
    } else {
      lastAudibleVolumeRef.current = video.volume
      video.muted = true
      setIsMuted(true)
    }
  }, [])

  const setMutedValue = useCallback((muted: boolean) => {
    const video = videoRef.current
    if (!video) return
    video.muted = muted
    setIsMuted(muted)
  }, [])

  const changePlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current
    if (!video) return
    const nextRate = Math.max(0.5, Math.min(3, rate))
    video.playbackRate = nextRate
    setPlaybackRate(nextRate)
  }, [])

  return {
    videoRef,
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    duration,
    setDuration,
    volume,
    isMuted,
    playbackRate,
    togglePlay,
    seek,
    seekBy,
    changeVolume,
    setVolumeValue,
    toggleMute,
    setMutedValue,
    changePlaybackRate,
  }
}
