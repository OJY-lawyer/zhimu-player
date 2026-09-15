import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AsrProgress } from '../../shared/contracts'
import type { AsrLanguage } from '../../shared/language'
import type { ActivePlaylist } from '../playerTypes'

const IDLE_PROGRESS: AsrProgress = {
  status: 'idle',
  message: '',
}

export function useAsrTranscription(
  playlist: ActivePlaylist | null,
  reloadPlaylist: () => Promise<void>,
  language: AsrLanguage = 'cn',
) {
  const [progress, setProgress] = useState<AsrProgress>(IDLE_PROGRESS)
  const [error, setError] = useState<string | null>(null)
  const missingItems = useMemo(
    () => playlist?.items.filter((item) => item.subtitles.length === 0) || [],
    [playlist],
  )

  useEffect(() => window.electronAPI.onAsrProgress(setProgress), [])

  const generateMissing = useCallback(async () => {
    if (missingItems.length === 0 || progress.status === 'running') return
    setError(null)
    setProgress({ status: 'running', message: `准备转写 ${missingItems.length} 个视频` })
    try {
      const result = await window.electronAPI.startAsrTranscription(
        missingItems.map((item) => item.path),
        language,
      )
      if (result.success) {
        await reloadPlaylist()
      } else if (!result.cancelled) {
        setError(result.message)
        setProgress({ status: 'failed', message: result.message })
      }
    } catch {
      const message = '播放器无法启动字幕任务，请重新打开后再试。'
      setError(message)
      setProgress({ status: 'failed', message })
    }
  }, [missingItems, progress.status, reloadPlaylist, language])

  const cancel = useCallback(async () => {
    await window.electronAPI.cancelAsrTranscription()
  }, [])

  return {
    missingCount: missingItems.length,
    isRunning: progress.status === 'running',
    progress,
    error,
    generateMissing,
    cancel,
  }
}
