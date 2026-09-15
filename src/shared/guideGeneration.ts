import type { ChatGptTier, GuideProvider } from './contracts'

export const DEFAULT_GUIDE_PROVIDER: GuideProvider = 'chatgpt-web'
export const CHATGPT_GUIDE_LABEL = 'ChatGPT · Astra · 极高'
export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-flash'
export function chatGptModelPolicy(tier: ChatGptTier) {
  return { model: 'gpt[- ]?6.*astra|astra', effort: tier === 'pro' ? '^pro$|^专业$' : '^xhigh$|^extra[ -]?high$|^极高$' }
}
export function chatGptTarget(tier: ChatGptTier = 'plus') {
  return tier === 'pro'
    ? { model: 'GPT-6 Astra', effort: 'Pro', label: 'ChatGPT · Astra · Pro' }
    : { model: 'GPT-6 Astra', effort: '极高', label: CHATGPT_GUIDE_LABEL }
}

export function normalizeGuideProvider(provider: unknown): GuideProvider {
  return provider === 'compatible-api' ? 'compatible-api' : DEFAULT_GUIDE_PROVIDER
}

export function guideProviderLabel(provider: GuideProvider, fallbackModel = '', tier: ChatGptTier = 'plus'): string {
  if (provider === 'chatgpt-web') return chatGptTarget(tier).label
  return fallbackModel.trim() ? 'API · ' + fallbackModel.trim() : 'DeepSeek API'
}

export function cleanGuideMarkdown(content: string): string {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  return (fenced?.[1] || trimmed).trim()
}

export function validateGuideMarkdown(content: string, partCount: number): string | null {
  const cleaned = cleanGuideMarkdown(content)
  const sections = cleaned.split(/^###\s+/m).slice(1)
  if (sections.length === 0) return '没有生成任何以 ### 开头的话题条目。'

  const timestamp = /\[P(\d+)-(\d{2,3}):([0-5]\d):([0-5]\d)\]/
  for (const section of sections) {
    const heading = section.split(/\r?\n/, 1)[0]
    const match = heading.match(timestamp)
    if (!match) return '话题“' + heading.slice(0, 40) + '”缺少严格的 [P数字-HH:MM:SS] 时间戳。'
    const part = Number(match[1])
    if (part < 1 || part > partCount) return '出现了不存在的 P' + part + ' 时间戳。'
  }
  return null
}
