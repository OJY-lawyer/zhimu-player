import { app, ipcMain } from 'electron'
import type { AIConfig, ChatGptGuideResult } from '../shared/contracts'
import { loadConfig } from './configStore'
import { normalizeApiEndpoint, registerApiModels } from './apiModels'

export { normalizeApiEndpoint } from './apiModels'
export async function requestCompletion(config: AIConfig, messages: unknown[], signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const endpoint = normalizeApiEndpoint(config.baseUrl)
  const deepseek = new URL(endpoint).hostname === 'api.deepseek.com'
  if (!config.model.trim()) throw new Error('请选择模型。')
  const response = await fetcher(endpoint, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, messages, ...(deepseek ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : {}) }),
  })
  if (!response.ok) {
    if (response.status === 401) throw new Error('API Key 无效或已过期，请在设置中更新。')
    if (response.status === 402) throw new Error('API 账户余额不足。')
    if (response.status === 429) throw new Error('API 额度或频率受限，请稍后再试。')
    throw new Error(`API 请求失败（HTTP ${response.status}）。`)
  }
  const data = await response.json()
  const choice = data?.choices?.[0]
  if (choice?.finish_reason !== 'stop') throw new Error('API 回答尚未完整结束（可能达到长度限制），未保存导读。')
  if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) throw new Error('API 没有返回导读正文。')
  return choice.message.content
}
export function registerApiGuide(): void {
  registerApiModels()
  let active: AbortController | null = null
  ipcMain.handle('api-guide', async (_event, messages): Promise<ChatGptGuideResult> => {
    if (active) return { success: false, message: '已有 API 导读任务正在运行。' }
    if (!Array.isArray(messages) || !messages.length || messages.length > 8 || messages.some(m => !['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string') || JSON.stringify(messages).length > 8_000_000) {
      return { success: false, message: '导读输入无效或过长，请缩小播放列表。' }
    }
    const controller = new AbortController()
    active = controller
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 20 * 60_000)
    try {
      const config = loadConfig(true)
      if (!config || config.provider !== 'compatible-api') throw new Error('请先选择并保存 API 导读设置。')
      const content = await requestCompletion(config, messages, controller.signal)
      if (controller.signal.aborted) throw new Error('cancelled')
      return { success: true, content, message: '导读已生成。' }
    } catch (error) {
      if (controller.signal.aborted) return { success: false, cancelled: !timedOut, message: timedOut ? 'API 等待超时，未保存导读。' : '已取消本地等待；云端已提交的请求可能仍会计费。' }
      return { success: false, message: error instanceof Error ? error.message : 'API 请求失败。' }
    } finally { clearTimeout(timeout); active = null }
  })
  ipcMain.handle('api-cancel', () => { if (!active) return false; active.abort(); return true })
  app.on('before-quit', () => active?.abort())
}
