import type { ChatGptWebSelection } from '../shared/contracts'

export interface WebModelControl {
  available: boolean
  label: string | null
  options: string[]
  matched: boolean
}

/** Runs inside a task-owned ChatGPT page. Chat content never supplies model evidence. */
function inspectControl(kind: 'model' | 'reasoning', action: 'read' | 'open' | 'choose' | 'check', selection: ChatGptWebSelection): WebModelControl {
  const visible = (node: Element): node is HTMLElement => node instanceof HTMLElement
    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
    && getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none'
    && !node.closest('[inert],[aria-hidden="true"],[data-active="false"]')
  const enabled = (node: Element) => node.getAttribute('aria-disabled') !== 'true' && !(node as HTMLButtonElement).disabled
  const excluded = '[data-message-author-role],article,nav,aside'
  const label = (node: Element) => ((node as HTMLElement).innerText || node.textContent || '').trim().replace(/\s+/g, ' ')
  const optionLabel = (node: Element) => {
    const text = ((node as HTMLElement).innerText || node.textContent || '').trim()
    return combined(text) ? text.replace(/\s+/g, ' ') : text.split(/\n/)[0].trim()
  }
  const exact = (value: string) => value.trim().toLowerCase().replace(/^chatgpt\s*/, '').replace(/\s+/g, ' ')
  const compact = (value: string) => value.toLowerCase().replace(/^chatgpt\s*/, '').replace(/[^\p{L}\p{N}]/gu, '')
  const effortKey = (value: string) => {
    const key = compact(value)
    if (['instant', '即时', '即時'].includes(key)) return 'instant'
    if (['medium', 'standard', '中', '中等', '标准', '標準'].includes(key)) return 'medium'
    if (['high', 'extended', '高', '较高'].includes(key)) return 'high'
    if (['extrahigh', 'xhigh', 'heavy', '极高', '極高'].includes(key)) return 'extrahigh'
    return exact(value)
  }
  const combined = (value: string): { model: string; reasoning: string } | null => {
    const key = compact(value)
    if (['56pro', 'gpt56pro', 'gpt56solpro', 'solpro'].includes(key)) return { model: 'gpt56sol', reasoning: 'pro' }
    if (['6pro', 'gpt6pro', 'gpt6astrapro', 'astrapro'].includes(key)) return { model: 'gpt6astra', reasoning: 'pro' }
    return null
  }
  const modelKey = (value: string) => {
    const merged = combined(value)
    if (merged) return merged.model
    const key = compact(value)
    if (['gpt6astra', 'gpt6', 'astra'].includes(key)) return 'gpt6astra'
    if (['gpt56sol', 'gpt56', 'sol'].includes(key)) return 'gpt56sol'
    return exact(value)
  }
  const selectedReasoning = selection.model.trim() === 'GPT-6 Pro' && selection.reasoning === null ? 'Pro' : selection.reasoning
  const wanted = kind === 'model' ? selection.model : selectedReasoning || ''
  const matches = (value: string) => {
    if (!value || !wanted) return false
    if (kind === 'reasoning') {
      const merged = combined(value)
      return merged ? merged.model === modelKey(selection.model) && merged.reasoning === effortKey(wanted)
        : effortKey(value) === effortKey(wanted)
    }
    if (['pro', '专业', '專業'].includes(compact(wanted))) return false
    if (modelKey(value) === modelKey(wanted)) return true
    // Chat also exposes Sol through Instant / Thinking controls rather than a family label.
    if (modelKey(wanted) === 'gpt56sol' && selection.reasoning) {
      return effortKey(selection.reasoning) === 'instant'
        ? effortKey(value) === 'instant'
        : ['medium', 'high', 'extrahigh'].includes(effortKey(selection.reasoning)) && ['thinking', '思考'].includes(compact(value))
    }
    return false
  }
  const controls = [...document.querySelectorAll('button[aria-haspopup]')].filter(visible)
    .filter(node => node.getAttribute('aria-haspopup') !== 'false' && enabled(node) && !node.closest(excluded))
  const primaryModels = controls.filter(node => /model-switcher/i.test(node.getAttribute('data-testid') || ''))
  const namedModels = controls.filter(node => /model|模型/i.test(node.getAttribute('aria-label') || '')
    && !/reason|think|思考|推理/i.test(node.getAttribute('aria-label') || ''))
  const modelCandidates = primaryModels.length ? primaryModels : namedModels.length ? namedModels
    : controls.filter(node => !!combined(label(node)))
  const modelControl = modelCandidates.length === 1 ? modelCandidates[0] : undefined
  const reasoningCandidates = controls.filter(node => node !== modelControl
    && !!node.closest('main,form') && (/reason|think|思考|推理/i.test((node.getAttribute('aria-label') || '') + ' ' + (node.getAttribute('data-testid') || ''))
      || /^(instant|medium|high|extra[ -]?high|standard|extended|heavy|pro|即时|中|中等|高|极高)$/i.test(label(node))))
  const control = kind === 'model' ? modelControl : reasoningCandidates.length === 1 ? reasoningCandidates[0]
    : reasoningCandidates.length === 0 && modelControl && combined(label(modelControl)) ? modelControl : undefined
  const controlled = (control?.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean)
  const menuSelector = '[role="menu"],[role="listbox"]'
  const visibleMenus = () => [...document.querySelectorAll(menuSelector)].filter(visible).filter(node => !node.closest(excluded))
  // Menus with no ARIA owner may only be associated after this helper clicked
  // their control. Previously visible menus and ambiguous new menus never qualify.
  const ownerAttribute = 'data-zhimu-menu-owner'
  const beforeAttribute = 'data-zhimu-menu-before'
  const pendingAttribute = 'data-zhimu-menu-pending'
  const owner = control?.getAttribute(ownerAttribute)
  const pending = Number(control?.getAttribute(pendingAttribute) || 0)
  if (control && owner && pending) {
    const appeared = visibleMenus().filter(node => node.getAttribute(beforeAttribute) !== owner)
    if (Date.now() - pending > 5000 || appeared.length > 1) control.removeAttribute(pendingAttribute)
    else if (appeared.length === 1) {
      appeared[0].setAttribute(ownerAttribute, owner)
      control.removeAttribute(pendingAttribute)
    }
  }
  const linked = !control || control.getAttribute('aria-expanded') === 'false' ? []
    : controlled.length ? controlled.map(id => document.getElementById(id)).filter((node): node is HTMLElement => !!node)
    : [...document.querySelectorAll(menuSelector)].filter(node => (control.id && (node.getAttribute('aria-labelledby') || '').split(/\s+/).includes(control.id))
      || (owner && node.getAttribute(ownerAttribute) === owner))
  const menus = linked.filter(visible).filter(node => !node.closest(excluded) && ['menu', 'listbox'].includes(node.getAttribute('role') || ''))
  const options = (menus.length === 1 ? [...menus[0].querySelectorAll('[role="menuitemradio"],[role="menuitem"],[role="option"]')] : [])
    .filter(visible).filter(enabled).filter(node => !node.closest(excluded))
    .filter(node => node.closest('[role="menu"],[role="listbox"]') === menus[0])
    .filter(node => {
      const text = optionLabel(node)
      if (!text || text.length > 120) return false
      if (node.getAttribute('aria-haspopup') && node.getAttribute('aria-haspopup') !== 'false') return false
      if (/^(select model|choose model|选择模型)$/i.test(node.getAttribute('aria-label') || '')) return false
      if (/^(more models|legacy models|configure|settings|更多模型|旧版模型|设置|配置)$/i.test(text)) return false
      return kind === 'model' ? /gpt|astra|sol|^(?:5\.6\s+pro|6\s+pro|instant|thinking|即时|思考)$/i.test(text)
        : /^(?:instant|medium|high|extra[ -]?high|xhigh|standard|extended|heavy|light|pro|即时|中|中等|标准|高|极高|专业)$/i.test(text)
    })
  if (action === 'open' && control) {
    const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    control.setAttribute(ownerAttribute, token)
    control.setAttribute(pendingAttribute, String(Date.now()))
    for (const menu of visibleMenus()) menu.setAttribute(beforeAttribute, token)
    control.click()
  }
  if (action === 'choose') {
    const candidates = options.filter(node => matches(optionLabel(node)))
    if (candidates.length === 1) candidates[0].click()
  }
  const selectedOptions = options.filter(node => node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true')
  const controlLabel = control ? label(control) : null
  const generic = (value: string) => /^(|model|models|select model|choose model|模型|选择模型|reasoning|reasoning level|thinking level|thinking time|推理|推理档位|思考时间)$/i.test(exact(value))
  const selectedOption = selectedOptions.length === 1 ? optionLabel(selectedOptions[0]) : null
  const sliders = kind === 'reasoning' ? linked.filter(visible).flatMap(node => [...node.querySelectorAll('[role="slider"],[type="range"]')])
    .filter(visible).filter(enabled).filter(node => !node.closest(excluded)) : []
  const sliderLabel = sliders.length === 1 ? sliders[0].getAttribute('aria-valuetext')?.trim() || null : null
  // Numeric slider positions are not model/effort evidence. Only an explicit
  // value label from this control's associated popup may confirm the level.
  const selected = sliderLabel || (controlLabel && !generic(controlLabel) ? controlLabel : selectedOption || controlLabel)
  const conflict = selectedOptions.length > 1 || sliders.length > 1
    || (!!controlLabel && !generic(controlLabel) && !!selectedOption && matches(controlLabel) !== matches(selectedOption))
    || (!!sliderLabel && !!controlLabel && !!combined(controlLabel) && matches(sliderLabel) !== matches(controlLabel))
  // Instant has no separate reasoning selector in the ordinary Chat layout.
  const instantSelected = kind === 'reasoning' && effortKey(wanted) === 'instant'
    && !control && !!modelControl && effortKey(label(modelControl)) === 'instant'
  const noSeparateReasoning = kind === 'reasoning' && selectedReasoning === null && !control
    && !!modelControl && modelKey(label(modelControl)) === modelKey(selection.model)
    && !['pro', '专业', '專業'].includes(compact(selection.model))
  return { available: Boolean(control), label: selected,
    options: [...new Set(options.map(optionLabel))], matched: !conflict && (instantSelected || noSeparateReasoning || Boolean(control && selected && matches(selected))) }
}

export function modelControlExpression(kind: 'model' | 'reasoning', action: 'read' | 'open' | 'choose' | 'check', selection: ChatGptWebSelection): string {
  return `(${inspectControl.toString()})(${JSON.stringify(kind)},${JSON.stringify(action)},${JSON.stringify(selection)})`
}

/** Compare service-reported model evidence. Missing effort is not proof of an effort level. */
export function answerModelMatches(selection: ChatGptWebSelection, actualModel: string, actualEffort?: string | null): boolean {
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
  const requested = key(selection.model), actual = key(actualModel)
  if (!actual || ['pro', '专业', 'thinking', 'instant', '思考', '即时'].includes(requested)) return false
  const effort = (value: string) => {
    const normalized = key(value)
    if (['instant', '即时', '即時'].includes(normalized)) return 'instant'
    if (['standard', 'medium', '中', '中等', '标准', '標準'].includes(normalized)) return 'medium'
    if (['extended', 'high', '高'].includes(normalized)) return 'high'
    if (['heavy', 'xhigh', 'extrahigh', '极高'].includes(normalized)) return 'extrahigh'
    return value.trim().toLowerCase()
  }
  const legacyPro = requested === 'gpt6pro' && selection.reasoning === null
  const requestedEffort = legacyPro ? 'pro' : selection.reasoning ? effort(selection.reasoning) : null
  const actualLevel = actualEffort ? effort(actualEffort) : null
  let explicitPro = false
  // Display names can separate their family suffix with spaces while service IDs
  // use hyphens. Preserve every other character, version dot and suffix.
  const serviceName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-')
  let matched = serviceName(actualModel) === serviceName(selection.model)
  if (['gpt56sol', 'gpt56', 'sol'].includes(requested)) {
    explicitPro = ['gpt56pro', 'gpt56solpro'].includes(actual)
    matched = explicitPro || ['gpt56', 'gpt56sol', 'gpt56thinking', 'gpt56instant'].includes(actual)
    const instant = requestedEffort === 'instant'
    if (actual === 'gpt56instant' && !instant) return false
    if (actual === 'gpt56thinking' && instant) return false
  } else if (['gpt6astra', 'gpt6', 'astra'].includes(requested) || legacyPro) {
    explicitPro = ['gpt6pro', 'gpt6astrapro', 'astrapro'].includes(actual)
    matched = explicitPro || ['gpt6astra', 'gpt6'].includes(actual)
  }
  if (!matched) return false
  if (explicitPro && requestedEffort !== 'pro') return false
  if (actualLevel && requestedEffort && actualLevel !== requestedEffort) return false
  if (requestedEffort === 'pro' && !explicitPro && actualLevel !== 'pro') return false
  return true
}
