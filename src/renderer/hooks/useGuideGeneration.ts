import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatGptGuideProgress } from '../../shared/contracts'
import {
  cleanGuideMarkdown,
  chatGptGuideVersionLabel,
  normalizeChatGptSelection,
  DEEPSEEK_MODEL,
  DEEPSEEK_URL,
  guideProviderLabel,
  normalizeGuideProvider,
  validateGuideMarkdown,
} from '../../shared/guideGeneration'
import type { AIConfig, Preset } from '../types'
import type { ActivePlaylist } from '../playerTypes'
import { formatTime } from '../utils/srtParser'
import { buildGuidePrompt } from '../../shared/guidePrompt'
import { normalizeGuideLanguage, type GuideLanguage } from '../../shared/language'
import { getAppLanguage } from '../i18n'

function buildTranscript(playlist: ActivePlaylist) {
  return playlist.items.map((item, index) => {
    const prefix = 'P' + (index + 1)
    const lines = item.subtitles.map((subtitle) =>
      '[' + prefix + '-' + formatTime(Math.max(0, subtitle.startTime - item.subtitleOffset)) + '] ' + subtitle.text,
    )
    return '## ' + prefix + ' ' + item.stem + '\n' + lines.join('\n')
  }).join('\n\n')
}

export function useGuideGeneration(
  playlist: ActivePlaylist | null,
  createVersion: (content: string, label?: string) => Promise<string | null>,
) {
  const [config, setConfig] = useState<AIConfig>(() => ({ baseUrl: DEEPSEEK_URL, apiKey: '', model: DEEPSEEK_MODEL, provider: 'chatgpt-web', chatGptSelection: null, chatGptProject: '', guideLanguage: 'source', asrLanguage: getAppLanguage() === 'en' ? 'en' : 'cn' }))
  const [configReady, setConfigReady] = useState(false)
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)
  const runProviderRef = useRef<'chatgpt-web' | 'compatible-api'>('chatgpt-web')
  const [presets, setPresets] = useState<Preset[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<ChatGptGuideProgress | null>(null)

  useEffect(() => window.electronAPI.onChatGptGuideProgress(setProgress), [])

  useEffect(() => {
    void Promise.all([
      window.electronAPI.loadConfig(),
      window.electronAPI.loadPresets(),
    ]).then(([savedConfig, savedPresets]) => {
      if (savedConfig) setConfig({ ...savedConfig, provider: normalizeGuideProvider(savedConfig.provider) })
      setPresets(savedPresets || [])
    }).catch(() => setError('读取导读模型配置失败。')).finally(() => setConfigReady(true))
  }, [])

  const saveConfig = useCallback(async (next: AIConfig) => {
    const normalized = { ...next, provider: normalizeGuideProvider(next.provider) }
    await window.electronAPI.saveConfig(normalized)
    setConfig(await window.electronAPI.loadConfig() || { ...normalized, apiKey: '', hasApiKey: !!normalized.apiKey })
  }, [])

  const saveLanguage = useCallback(async (language: GuideLanguage) => {
    if (runningRef.current) return
    try {
      await window.electronAPI.saveGuideLanguage(language)
      setConfig(previous => ({ ...previous, guideLanguage: language }))
    } catch { setError('保存导读语言失败，请重试。') }
  }, [])

  const savePreset = useCallback(async (preset: Preset) => {
    const next = presets.some((item) => item.id === preset.id)
      ? presets.map((item) => item.id === preset.id ? preset : item)
      : [...presets, preset]
    setPresets(next)
    setActivePresetId(preset.id)
    await window.electronAPI.savePresets(next)
  }, [presets])

  const deletePreset = useCallback(async (id: string) => {
    const next = presets.filter((preset) => preset.id !== id)
    setPresets(next)
    if (activePresetId === id) setActivePresetId(null)
    await window.electronAPI.savePresets(next)
  }, [activePresetId, presets])

  const generate = useCallback(async () => {
    if (!playlist || runningRef.current) return
    const provider = normalizeGuideProvider(config.provider)
    const chatSelection = normalizeChatGptSelection(config.chatGptSelection)
    if (provider === 'chatgpt-web' && !chatSelection) {
      setError(getAppLanguage() === 'en' ? 'Choose a ChatGPT web model and reasoning level in Settings first.' : '请先在设置中选择 ChatGPT 网页模型和推理档位。')
      setShowConfig(true)
      return
    }
    if (provider === 'compatible-api' && (!config.baseUrl || !config.model)) {
      setError('请先配置导读模型。')
      setShowConfig(true)
      return
    }
    if (playlist.items.some((item) => item.subtitles.length === 0)) {
      setError('播放列表字幕不齐，已阻止生成导读。')
      return
    }

    runningRef.current = true
    runProviderRef.current = provider
    cancelledRef.current = false
    setIsGenerating(true)
    setError(null)
    try {
      const outputLanguage = normalizeGuideLanguage(config.guideLanguage)
      const prompt = buildGuidePrompt(playlist.displayName, playlist.items.length, buildTranscript(playlist), outputLanguage)
      let result = ''
      let versionLabel = ''

      if (provider === 'chatgpt-web') {
        setProgress({ status: 'running', stage: 'preparing', message: '正在准备字幕任务', attempt: 1 })
        const first = await window.electronAPI.generateChatGptGuide({
          taskMarkdown: prompt,
          playlistName: playlist.displayName,
          selection: chatSelection!,
          projectName: config.chatGptProject,
        })
        if (first.cancelled) {
          setProgress({ status: 'cancelled', stage: 'completed', message: first.message })
          return
        }
        if (!first.success || !first.content) throw new Error(first.message)
        result = cleanGuideMarkdown(first.content)
        versionLabel = chatGptGuideVersionLabel(chatSelection!) + '.' + outputLanguage
      } else {
        setProgress({ status: 'running', stage: 'waiting', message: 'API 正在生成导读', attempt: 1 })
        const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: prompt }]
        const request = async () => {
          const response = await window.electronAPI.requestApiGuide(messages)
          if (response.cancelled) { cancelledRef.current = true; throw new Error(response.message) }
          if (!response.success || !response.content) throw new Error(response.message)
          return response.content
        }
        result = await request()
        result = cleanGuideMarkdown(result)
        versionLabel = 'Guide.API-' + config.model + '.' + outputLanguage
      }

      if (cancelledRef.current) return
      const finalError = validateGuideMarkdown(result, playlist.items.length)
      if (finalError) throw new Error('导读未通过格式校验，未保存：' + finalError)
      setProgress({ status: 'running', stage: 'completed', message: '正在保存新的本地导读版本' })
      const saved = await createVersion(result, versionLabel)
      if (!saved) throw new Error('导读已生成，但保存新版本失败。')
      setProgress({ status: 'completed', stage: 'completed', message: '新导读已经保存' })
    } catch (caught) {
      if (cancelledRef.current) { setProgress({ status: 'cancelled', stage: 'completed', message: '已取消本地导读任务，云端已提交的请求可能继续运行。' }); return }
      const message = caught instanceof Error ? caught.message : '生成导读失败。'
      setError(message)
      setProgress({ status: 'failed', stage: 'completed', message })
    } finally {
      setIsGenerating(false)
      runningRef.current = false
    }
  }, [config, createVersion, playlist])

  const cancel = useCallback(async () => {
    cancelledRef.current = true
    const cancelled = await (runProviderRef.current === 'chatgpt-web' ? window.electronAPI.cancelChatGptGuide() : window.electronAPI.cancelApiGuide())
    if (cancelled) setProgress({ status: 'cancelled', stage: 'completed', message: '已取消导读任务' })
  }, [])

  const provider = normalizeGuideProvider(config.provider)

  return {
    config,
    configReady,
    presets,
    activePresetId,
    showConfig,
    isGenerating,
    error,
    progress,
    provider,
    providerLabel: guideProviderLabel(provider, config.model, config.chatGptSelection),
    setShowConfig,
    saveConfig,
    saveLanguage,
    savePreset,
    deletePreset,
    generate,
    cancel,
  }
}
