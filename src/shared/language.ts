export type AppLanguage = 'zh-CN' | 'en'
export type GuideLanguage = AppLanguage | 'source'
export type AsrLanguage = 'cn' | 'en'

export function detectAppLanguage(locale: string | undefined): AppLanguage {
  return /^zh(?:-|_|$)/i.test(locale || '') ? 'zh-CN' : 'en'
}
export function normalizeGuideLanguage(value: unknown, fallback: GuideLanguage = 'zh-CN'): GuideLanguage {
  return value === 'en' || value === 'source' || value === 'zh-CN' ? value : fallback
}
export function guideLanguageInstruction(language: GuideLanguage): string {
  if (language === 'en') return 'Write all guide titles, headings, and descriptions in English. Keep proper names faithful to the transcript. Do not translate or change [P1-HH:MM:SS] timestamp markers.'
  if (language === 'source') return 'Write the guide in the predominant language of the transcript. Preserve quoted terms and names faithfully. Do not translate or change [P1-HH:MM:SS] timestamp markers.'
  return '使用简体中文撰写导读的标题、话题标题与概述，忠实保留原字幕中的专有名词；不得翻译或改写 [P1-HH:MM:SS] 时间戳标记。'
}
