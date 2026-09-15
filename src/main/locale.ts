import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { detectAppLanguage, type AppLanguage } from '../shared/language'
let current: AppLanguage | undefined
export function getAppLanguage(): AppLanguage {
  if (current) return current
  try { const value = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'locale.json'), 'utf8')); if (value.language === 'en' || value.language === 'zh-CN') return current = value.language } catch { /* Default to system language on a new installation. */ }
  return current = detectAppLanguage(app.getLocale?.() || 'zh-CN')
}
export function setAppLanguage(language: AppLanguage): void {
  if (language !== 'en' && language !== 'zh-CN') throw new Error('Unsupported interface language')
  const target = path.join(app.getPath('userData'), 'locale.json')
  fs.writeFileSync(target + '.tmp', JSON.stringify({ language }), 'utf8')
  fs.renameSync(target + '.tmp', target)
  current = language
}
export function nativeText(zh: string, en: string): string { return getAppLanguage() === 'en' ? en : zh }
