import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AIConfig, Preset } from '../shared/contracts'
import { DEEPSEEK_MODEL, DEEPSEEK_URL } from '../shared/guideGeneration'
import { normalizeGuideLanguage, type GuideLanguage } from '../shared/language'

type Stored = Record<string, unknown> & { apiKey?: string; apiKeyEncrypted?: string }
function location(name: string) { return path.join(app.getPath('userData'), name) }
function read(name: string): unknown {
  try { return JSON.parse(fs.readFileSync(location(name), 'utf8')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('设置文件无法读取，请保留文件并联系维护者。') }
}
function write(name: string, value: unknown) {
  const target = location(name)
  const temp = target + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temp, target)
}
function decrypt(value: Stored): string {
  if (!value.apiKeyEncrypted) return value.apiKey || ''
  try { return safeStorage.decryptString(Buffer.from(value.apiKeyEncrypted, 'base64')) }
  catch { throw new Error('API Key 无法在当前 Windows 账户下解密，请重新填写。') }
}
function encrypt(value: Stored, secret: string): Stored {
  const { apiKey: _key, apiKeyEncrypted: _encrypted, clearApiKey: _clear, hasApiKey: _has, ...rest } = value
  if (!secret) return rest
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据加密不可用，未保存 API Key。')
  return { ...rest, apiKeyEncrypted: safeStorage.encryptString(secret).toString('base64') }
}
function expose(value: Stored): Stored {
  const { apiKey: _key, apiKeyEncrypted: _encrypted, ...rest } = value
  return { ...rest, apiKey: '', hasApiKey: Boolean(value.apiKeyEncrypted || value.apiKey) }
}
export function loadConfig(secret = false): AIConfig | null {
  const raw = read('config.json') as Stored | null
  if (!raw) return null
  // Migrate secrets only inside the main process; never copy them to the renderer.
  let stored = raw
  if (raw.apiKey) { stored = encrypt(raw, raw.apiKey); write('config.json', stored) }
  const migrated = {
    baseUrl: DEEPSEEK_URL, model: DEEPSEEK_MODEL,
    ...expose(stored),
    // Preserve the old explicitly Pro workflow when opening an existing installation.
    chatGptTier: raw.chatGptTier || 'pro',
    chatGptProject: raw.chatGptProject ?? '视频总结对话专用项目',
    guideLanguage: normalizeGuideLanguage(raw.guideLanguage),
    asrLanguage: raw.asrLanguage === 'en' ? 'en' : 'cn',
  } as AIConfig
  return secret ? { ...migrated, apiKey: decrypt(stored) } : migrated
}
export function saveGuideLanguage(language: GuideLanguage): void {
  if (!['zh-CN', 'en', 'source'].includes(language)) throw new Error('Unsupported guide language')
  const existing = read('config.json') as Stored | null
  const defaults = { provider: 'chatgpt-web', baseUrl: DEEPSEEK_URL, model: DEEPSEEK_MODEL, chatGptTier: 'plus', chatGptProject: '' }
  write('config.json', { ...(existing || defaults), guideLanguage: language })
}
export function saveConfig(config: AIConfig): string {
  const existing = read('config.json') as Stored | null
  let sameOrigin = false
  try { sameOrigin = !!existing && new URL(String(existing.baseUrl)).origin === new URL(config.baseUrl).origin } catch { /* A changed or invalid destination never inherits a secret. */ }
  const key = config.clearApiKey ? '' : config.apiKey.trim() || (existing && sameOrigin ? decrypt(existing) : '')
  write('config.json', encrypt(config as unknown as Stored, key))
  return location('config.json')
}
/** Resolve a settings draft inside the main process without saving or exposing its secret. */
export function resolveDraftApiKey(draft: Pick<AIConfig, 'baseUrl' | 'apiKey' | 'clearApiKey'>): string {
  if (draft.clearApiKey) return ''
  if (draft.apiKey.trim()) return draft.apiKey.trim()
  const existing = read('config.json') as Stored | null
  if (!existing) return ''
  let sameOrigin = false
  try { sameOrigin = new URL(String(existing.baseUrl)).origin === new URL(draft.baseUrl).origin } catch { /* Invalid or changed destinations cannot inherit a secret. */ }
  return sameOrigin ? decrypt(existing) : ''
}
export function loadPresets(): Preset[] {
  const raw = (read('presets.json') || []) as Stored[]
  const migrated = raw.map(value => value.apiKey ? encrypt(value, value.apiKey) : value)
  if (raw.some(value => value.apiKey)) write('presets.json', migrated)
  return migrated.map(expose) as unknown as Preset[]
}
export function savePresets(presets: Preset[]): void {
  const old = (read('presets.json') || []) as Stored[]
  write('presets.json', presets.map(preset => {
    const previous = old.find(item => item.id === preset.id)
    return encrypt(preset as unknown as Stored, preset.apiKey || (previous ? decrypt(previous) : ''))
  }))
}
