import { useSyncExternalStore } from 'react'
import { detectAppLanguage, type AppLanguage } from '../shared/language'
import { translateRuntimeMessage } from '../shared/runtimeMessages'

const KEY = 'ai-video-player.ui-language'
function initialLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'zh-CN'
  try { const stored = localStorage.getItem(KEY); if (stored === 'en' || stored === 'zh-CN') return stored } catch { /* Storage may not exist in offline tests. */ }
  return typeof navigator === 'undefined' ? 'zh-CN' : detectAppLanguage(navigator.language)
}
let language = initialLanguage()
let revision = 0
const listeners = new Set<() => void>()
export const getAppLanguage = () => language
export const t = (zh: string, en: string): string => language === 'en' ? en : zh
export const translateMessage = (message: string): string => translateRuntimeMessage(message, language)
function applyLanguage(next: AppLanguage): void {
  language = next
  try { localStorage.setItem(KEY, next) } catch { /* Main-process preferences remain authoritative. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = next
  listeners.forEach(listener => listener())
}
export function setLanguage(next: AppLanguage): void {
  if (next !== 'en' && next !== 'zh-CN') return
  revision++
  applyLanguage(next)
  if (typeof window !== 'undefined') void window.electronAPI?.setUiLanguage?.(next).catch(() => { /* The UI retains its local selection. */ })
}
export async function initializeLanguage(): Promise<void> {
  const startedAt = revision
  if (typeof window === 'undefined' || !window.electronAPI?.getUiLanguage) return
  const saved = await window.electronAPI.getUiLanguage()
  if (startedAt === revision) applyLanguage(saved)
}
export function useI18n() {
  const current = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback) } }, () => language, () => 'zh-CN' as AppLanguage)
  return { language: current, setLanguage, t, translateMessage }
}
