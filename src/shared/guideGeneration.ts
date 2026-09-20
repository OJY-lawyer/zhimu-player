import type { ChatGptWebModelOption, ChatGptWebSelection, GuideProvider } from './contracts'

export const DEFAULT_GUIDE_PROVIDER: GuideProvider = 'chatgpt-web'
export const CHATGPT_GUIDE_LABEL = 'ChatGPT'
export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
export const DEEPSEEK_MODEL = 'deepseek-flash'
// Chat presets are candidates only; each model and level must be checked on the website.
export const CHATGPT_WEB_PRESETS: readonly ChatGptWebModelOption[] = [
  { model: 'GPT-5.6 Sol', reasoningOptions: ['Instant', 'Medium', 'High', 'Extra High', 'Pro'] },
  { model: 'GPT-6 Astra', reasoningOptions: ['Pro'] },
]

export function normalizeChatGptSelection(value: unknown): ChatGptWebSelection | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const validLabel = (label: unknown): label is string => typeof label === 'string' && !!label.trim()
    && label.length <= 120 && !/[\u0000-\u001f\u007f]/.test(label)
  if (!validLabel(candidate.model) || (candidate.reasoning !== null && !validLabel(candidate.reasoning))) return null
  const model = candidate.model.trim()
  const reasoning = candidate.reasoning === null ? null : candidate.reasoning.trim()
  // rc.9 briefly stored Astra's Pro level as a separate model with no level.
  // Only that exact representation is an alias; preserve other explicit labels.
  return model === 'GPT-6 Pro' && reasoning === null
    ? { model: 'GPT-6 Astra', reasoning: 'Pro' }
    : { model, reasoning }
}

export function chatGptModelPolicy(selection: ChatGptWebSelection) {
  const selected = normalizeChatGptSelection(selection) || selection
  const exact = (label: string) => '^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + '$'
  return { model: exact(selected.model), effort: selected.reasoning === null ? null : exact(selected.reasoning) }
}

export function chatGptTarget(selection?: ChatGptWebSelection | null) {
  const selected = normalizeChatGptSelection(selection)
  return selected
    ? { model: selected.model, effort: selected.reasoning, label: [CHATGPT_GUIDE_LABEL, selected.model, selected.reasoning].filter(Boolean).join(' · ') }
    : { model: '', effort: null, label: CHATGPT_GUIDE_LABEL }
}

/** Keep the chosen website labels in new filenames without allowing path separators. */
export function chatGptGuideVersionLabel(selection: ChatGptWebSelection): string {
  const selected = normalizeChatGptSelection(selection) || selection
  const safe = (label: string) => label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '-').replace(/[. ]+$/g, '').slice(0, 80)
  return 'Guide.ChatGPT-' + [selected.model, selected.reasoning].filter((value): value is string => value !== null).map(safe).join('-')
}

export function normalizeGuideProvider(provider: unknown): GuideProvider {
  return provider === 'compatible-api' ? 'compatible-api' : DEFAULT_GUIDE_PROVIDER
}

export function guideProviderLabel(provider: GuideProvider, fallbackModel = '', selection?: ChatGptWebSelection | null): string {
  if (provider === 'chatgpt-web') return chatGptTarget(selection).label
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
