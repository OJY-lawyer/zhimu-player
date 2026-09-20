import type { ChatGptWebModelOption, ChatGptWebSelection } from '../shared/contracts'

interface CdpTransport {
  send<T>(method: string, params?: Record<string, unknown>, sessionId?: string, timeoutMs?: number): Promise<T>
}
interface Point { x: number; y: number }
interface SliderState { position: number; min: number; max: number; reasoning: string; announcement: string; focused: boolean }
interface IntelligenceState {
  recognized: boolean
  menuPresent: boolean
  triggerExpanded: boolean
  trigger: Point | null
  triggerLabel: string
  modelBadge: string
  toggle: Point | null
  view: 'simple' | 'advanced' | null
  radios: { label: string; checked: boolean; point: Point }[]
  slider: SliderState | null
}
interface SavedSelection { radio: string; position: number; reasoning: string; min: number; max: number }

/** Serialized page code. Only observed DOM/accessibility attributes are used; no React state. */
function inspectIntelligence(action: 'read' | 'focus-slider'): IntelligenceState {
  const excluded = '[data-message-author-role],article,nav,aside'
  const unavailable = '[inert],[aria-hidden="true"],[data-active="false"]'
  const rendered = (node: Element): node is HTMLElement => node instanceof HTMLElement && !node.closest(excluded)
    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0
    && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden'
  const visible = (node: Element): node is HTMLElement => rendered(node) && !node.closest(unavailable)
  const enabled = (node: Element) => node.getAttribute('aria-disabled') !== 'true' && !(node as HTMLButtonElement).disabled
  const text = (node: Element) => ((node as HTMLElement).innerText || node.textContent || '').trim()
  const compact = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const point = (node: Element): Point => { const rect = node.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }
  const reasoning = (value: string): string | null => {
    const key = compact(value)
    if (['instant', '即时', '即時'].includes(key)) return 'Instant'
    if (['medium', '中', '中等'].includes(key)) return 'Medium'
    if (['high', '高'].includes(key)) return 'High'
    if (['extrahigh', '极高', '極高'].includes(key)) return 'Extra High'
    if (['pro', '专业', '專業'].includes(key)) return 'Pro'
    return null
  }
  // A closing portal can remain visible (and intercept clicks) after aria-expanded
  // becomes false. Track its rendered presence separately from usable controls.
  const renderedRoots = [...document.querySelectorAll('[data-testid="composer-intelligence-picker-content"]')].filter(rendered)
  const roots = renderedRoots.filter(visible)
  const root = roots.length === 1 ? roots[0] : null
  const menu = root?.closest('[role="menu"]')
  const ownerIds = (menu?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
  const owners = ownerIds.map(id => document.getElementById(id)).filter((node): node is HTMLElement => !!node && visible(node)
    && node.tagName === 'BUTTON' && node.getAttribute('aria-haspopup') === 'menu' && enabled(node))
  const candidates = [...document.querySelectorAll('button[aria-haspopup="menu"]')].filter(visible).filter(enabled)
    .filter(node => !!node.closest('main,form'))
    .filter(node => {
      const label = compact(text(node)).replace(/^chatgpt/, '')
      if (reasoning(text(node))) return true
      // This identifies a possible opener, never the selected model's identity.
      return /^(?:(?:gpt)?56(?:sol)?|(?:gpt)?6(?:astra)?|(?:gpt)?55)(?:instant|medium|high|extrahigh|pro|即时|中|中等|高|极高)?$/.test(label)
    })
  const trigger = root ? owners.length === 1 ? owners[0] : null : candidates.length === 1 ? candidates[0] : null
  const menuPresent = renderedRoots.some(node => { const parent = node.closest('[role="menu"]'); return !!parent && rendered(parent) })
  const triggerExpanded = trigger?.getAttribute('aria-expanded') === 'true'
  const closing = !!root?.closest('[data-state="closed"]') || menu?.getAttribute('data-state') === 'closed'
  const result: IntelligenceState = { recognized: !!(root && menu && visible(menu) && trigger && trigger.getAttribute('aria-expanded') !== 'false' && !closing),
    menuPresent, triggerExpanded, trigger: trigger ? point(trigger) : null,
    triggerLabel: trigger ? text(trigger).replace(/\s+/g, ' ') : '', modelBadge: '', toggle: null, view: null, radios: [], slider: null }
  if (!result.recognized || !root) return result
  const toggles = [...root.querySelectorAll('[role="menuitem"][aria-label]')].filter(visible).filter(enabled)
    .filter(node => /^(选择模型|選擇模型|select model|choose model|choose a model)$/i.test(node.getAttribute('aria-label') || ''))
  if (toggles.length === 1) {
    result.toggle = point(toggles[0])
    // The outer pill can show a hover label such as “思考强度”. Its associated
    // visible model toggle retains the actual combined badge (for example “6 Pro”).
    result.modelBadge = text(toggles[0]).replace(/\s+/g, ' ')
  }
  const simplePanels = [...root.querySelectorAll('[data-testid="composer-model-picker-slider-simple-view"]')].filter(visible)
  const advancedPanels = [...root.querySelectorAll('[data-testid="composer-model-picker-slider-advanced-view"]')].filter(visible)
  if (simplePanels.length === 1 && advancedPanels.length === 0) result.view = 'simple'
  if (advancedPanels.length === 1 && simplePanels.length === 0) result.view = 'advanced'
  if (result.view === 'advanced') {
    result.radios = [...advancedPanels[0].querySelectorAll('[role="menuitemradio"]')].filter(visible).filter(enabled)
      .map(node => ({ label: text(node).split(/\n/)[0].trim(), checked: node.getAttribute('aria-checked') === 'true', point: point(node) }))
      .filter(option => !!option.label && option.label.length <= 120)
  }
  if (result.view !== 'simple') return result
  const controllers = [...simplePanels[0].querySelectorAll('[role="menuitem"][aria-keyshortcuts]')].filter(visible).filter(enabled)
    .filter(node => { const keys = (node.getAttribute('aria-keyshortcuts') || '').split(/\s+/); return keys.includes('ArrowLeft') && keys.includes('ArrowRight') })
  if (controllers.length !== 1) return result
  const controller = controllers[0]
  // The observed accessibility slider is aria-hidden. Only its numeric metadata is read;
  // its visible, active menuitem is the actual keyboard target.
  const sliders = [...controller.querySelectorAll('[role="slider"]')]
  if (sliders.length !== 1) return result
  const integer = (name: string) => { const value = sliders[0].getAttribute(name); return value !== null && /^\d+$/.test(value) ? Number(value) : NaN }
  const position = integer('aria-valuenow'), min = integer('aria-valuemin'), max = integer('aria-valuemax')
  if (![position, min, max].every(Number.isSafeInteger) || min > position || position > max || max - min > 9 || max < min) return result
  const announcements = (controller.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    .map(id => document.getElementById(id)).filter((node): node is HTMLElement => !!node && root.contains(node)
      && !node.closest('[inert],[data-active="false"]') && !node.closest(excluded)).map(text)
  const matched = announcements.map(value => {
    const parsed = value.match(/^(.+?)[,，]\s*(?:第\s*(\d+)\s*项\s*[,，]\s*共\s*(\d+)\s*项|(?:item\s*)?(\d+)\s+(?:of|out of)\s+(\d+))/i)
    if (!parsed) return null
    const level = reasoning(parsed[1]), ordinal = Number(parsed[2] || parsed[4]), count = Number(parsed[3] || parsed[5])
    return ordinal === position - min + 1 && count === max - min + 1 ? { reasoning: level || '', announcement: value } : null
  }).filter((value): value is { reasoning: string; announcement: string } => !!value)
  if (matched.length !== 1) return result
  if (action === 'focus-slider') controller.focus({ preventScroll: true })
  result.slider = { position, min, max, ...matched[0], focused: document.activeElement === controller }
  return result
}

const MAX_LEVELS = 10
const compact = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const radioKey = (value: string) => ['latest', '最新'].includes(compact(value)) ? 'latest' : compact(value)
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 100))

async function inspect(cdp: CdpTransport, sessionId: string, focus = false): Promise<IntelligenceState> {
  const response = await cdp.send<{ result?: { value?: IntelligenceState }; exceptionDetails?: unknown }>('Runtime.evaluate', {
    expression: `(${inspectIntelligence.toString()})(${JSON.stringify(focus ? 'focus-slider' : 'read')})`, returnByValue: true,
  }, sessionId, 5000)
  if (response.exceptionDetails || !response.result?.value) throw new Error('ChatGPT intelligence controls could not be read.')
  return response.result.value
}
async function key(cdp: CdpTransport, sessionId: string, key: 'Escape' | 'ArrowLeft' | 'ArrowRight'): Promise<void> {
  const code = key === 'Escape' ? 27 : key === 'ArrowLeft' ? 37 : 39
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }, sessionId, 5000)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }, sessionId, 5000)
}
async function click(cdp: CdpTransport, sessionId: string, point: Point): Promise<void> {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0) throw new Error('ChatGPT control is outside the viewport.')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none' }, sessionId, 5000)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, sessionId, 5000)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, sessionId, 5000)
}
async function waitFor(cdp: CdpTransport, sessionId: string, predicate: (state: IntelligenceState) => boolean): Promise<IntelligenceState | null> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const state = await inspect(cdp, sessionId)
    if (predicate(state)) return state
    await delay()
  }
  return null
}
async function open(cdp: CdpTransport, sessionId: string): Promise<IntelligenceState | null> {
  let state = await inspect(cdp, sessionId)
  if (state.recognized) return state
  if (state.menuPresent || state.triggerExpanded) {
    const settled = await waitFor(cdp, sessionId, next => next.recognized || !next.menuPresent && !next.triggerExpanded)
    if (!settled) return null
    state = settled
    if (state.recognized) return state
  }
  if (!state.trigger) return null
  await click(cdp, sessionId, state.trigger)
  return waitFor(cdp, sessionId, next => next.recognized)
}
async function close(cdp: CdpTransport, sessionId: string): Promise<boolean> {
  await key(cdp, sessionId, 'Escape')
  let closedReads = 0
  return !!await waitFor(cdp, sessionId, state => {
    closedReads = !state.menuPresent && !state.triggerExpanded ? closedReads + 1 : 0
    return closedReads >= 2
  })
}
async function view(cdp: CdpTransport, sessionId: string, target: 'simple' | 'advanced'): Promise<IntelligenceState | null> {
  let state = await open(cdp, sessionId)
  if (!state) return null
  if (!state.view) state = await waitFor(cdp, sessionId, next => next.recognized && next.view !== null)
  if (!state) return null
  if (state.view === target) return state
  if (target === 'simple' && state.view === 'advanced' && !state.toggle) {
    // The observed advanced view has only model radios. Re-select its checked radio
    // to return without choosing a different family; some layouts close the menu.
    const checked = state.radios.filter(option => option.checked)
    if (checked.length !== 1) return null
    await click(cdp, sessionId, checked[0].point)
    const returned = await waitFor(cdp, sessionId, next => !next.recognized || next.view === 'simple')
    if (!returned) return null
    const reopened = returned.recognized ? returned : await open(cdp, sessionId)
    return reopened?.view === 'simple' ? reopened : null
  }
  if (!state.toggle) return null
  await click(cdp, sessionId, state.toggle)
  return waitFor(cdp, sessionId, next => next.recognized && next.view === target)
}
async function selectedRadio(cdp: CdpTransport, sessionId: string): Promise<string | null> {
  const state = await view(cdp, sessionId, 'advanced')
  const checked = state?.radios.filter(option => option.checked) || []
  return checked.length === 1 ? checked[0].label : null
}
async function capture(cdp: CdpTransport, sessionId: string): Promise<SavedSelection | null> {
  const state = await view(cdp, sessionId, 'simple')
  if (!state?.slider?.reasoning) return null
  const radio = await selectedRadio(cdp, sessionId)
  let back = await view(cdp, sessionId, 'simple')
  if (!radio || !back?.slider) return null
  if (back.slider.position !== state.slider.position) back = await toPosition(cdp, sessionId, state.slider.position)
  if (!back?.slider || back.slider.reasoning !== state.slider.reasoning) return null
  return { radio, position: state.slider.position, reasoning: state.slider.reasoning, min: state.slider.min, max: state.slider.max }
}
async function chooseRadio(cdp: CdpTransport, sessionId: string, wanted: string): Promise<boolean> {
  const state = await view(cdp, sessionId, 'advanced')
  const choices = state?.radios.filter(option => radioKey(option.label) === radioKey(wanted)) || []
  if (choices.length !== 1) return false
  if (!choices[0].checked) {
    await click(cdp, sessionId, choices[0].point)
    await delay()
  }
  if (radioKey(await selectedRadio(cdp, sessionId) || '') !== radioKey(wanted)) return false
  return !!(await view(cdp, sessionId, 'simple'))?.slider
}
async function step(cdp: CdpTransport, sessionId: string, direction: -1 | 1): Promise<IntelligenceState | null> {
  const state = await inspect(cdp, sessionId)
  const slider = state.slider
  if (!state.recognized || state.view !== 'simple' || !slider) return null
  const nextPosition = slider.position + direction
  if (nextPosition < slider.min || nextPosition > slider.max) return null
  const unchanged = (next: IntelligenceState) => next.recognized && next.view === 'simple'
    && next.modelBadge === state.modelBadge && next.slider?.position === slider.position
    && next.slider.min === slider.min && next.slider.max === slider.max && next.slider.reasoning === slider.reasoning
  for (let attempt = 0; attempt < 2; attempt++) {
    // A newly returned simple view can replace its focused menuitem. Confirm
    // focus survives a separate read before sending a key to the live control.
    let focused: IntelligenceState | null = null
    for (let focusAttempt = 0; focusAttempt < 3; focusAttempt++) {
      const requested = await inspect(cdp, sessionId, true)
      if (!unchanged(requested) || !requested.slider?.focused) return null
      await delay()
      const stable = await inspect(cdp, sessionId)
      if (!unchanged(stable)) return null
      if (stable.slider?.focused) { focused = stable; break }
    }
    if (!focused) return null
    await key(cdp, sessionId, direction < 0 ? 'ArrowLeft' : 'ArrowRight')
    let last = focused
    let stayedUnchanged = true
    const moved = await waitFor(cdp, sessionId, next => {
      last = next
      stayedUnchanged = stayedUnchanged && unchanged(next)
      return !!next.slider && next.slider.position !== slider.position
    })
    if (moved) return moved.recognized && moved.view === 'simple' && moved.slider?.position === nextPosition
      && moved.slider.min === slider.min && moved.slider.max === slider.max ? moved : null
    // The observed Pro -> Medium failure loses focus without moving at all.
    // Retry once only after the whole wait confirms the same model/level/range;
    // never replay a key after a delayed, ambiguous or unexpected movement.
    if (!stayedUnchanged || last.slider?.focused) return null
  }
  return null
}
async function toPosition(cdp: CdpTransport, sessionId: string, position: number): Promise<IntelligenceState | null> {
  let state = await view(cdp, sessionId, 'simple')
  if (!state?.slider || position < state.slider.min || position > state.slider.max) return null
  for (let count = 0; count < MAX_LEVELS; count++) {
    if (state.slider?.position === position) return state
    state = await step(cdp, sessionId, position < state.slider!.position ? -1 : 1)
    if (!state?.slider) return null
  }
  return null
}
async function restore(cdp: CdpTransport, sessionId: string, saved: SavedSelection): Promise<boolean> {
  if (!await chooseRadio(cdp, sessionId, saved.radio)) return false
  const state = await toPosition(cdp, sessionId, saved.position)
  if (!state?.slider || state.slider.reasoning !== saved.reasoning || state.slider.min !== saved.min || state.slider.max !== saved.max) return false
  const radio = await selectedRadio(cdp, sessionId)
  const final = await view(cdp, sessionId, 'simple')
  return radioKey(radio || '') === radioKey(saved.radio) && final?.slider?.position === saved.position && final.slider.reasoning === saved.reasoning
}
function identity(radio: string, state: IntelligenceState): 'sol' | 'astra' | null {
  const owner = radioKey(radio), label = compact(state.modelBadge)
  if (owner === 'gpt56sol') {
    if (['6pro', 'gpt6pro', 'astrapro', 'gpt6astrapro'].includes(label)) return null
    return 'sol'
  }
  return owner === 'latest' && state.slider?.reasoning === 'Pro' && ['6pro', 'gpt6pro', 'astrapro', 'gpt6astrapro'].includes(label) ? 'astra' : null
}
async function scan(cdp: CdpTransport, sessionId: string, visit: (state: IntelligenceState) => boolean): Promise<boolean> {
  const initial = await view(cdp, sessionId, 'simple')
  if (!initial?.slider) return false
  let state = await toPosition(cdp, sessionId, initial.slider.min)
  for (let count = 0; count < MAX_LEVELS; count++) {
    if (!state?.slider?.reasoning) return false
    if (visit(state)) return true
    if (state.slider.position === state.slider.max) return false
    state = await step(cdp, sessionId, 1)
  }
  return false
}

export async function detectChatGptIntelligence(cdp: CdpTransport, sessionId: string): Promise<boolean> {
  let detected = false, closed = false
  try { detected = !!(await open(cdp, sessionId))?.recognized }
  catch { detected = false }
  finally { closed = await close(cdp, sessionId).catch(() => false) }
  return detected && closed
}

export async function selectChatGptIntelligence(cdp: CdpTransport, sessionId: string, selection: ChatGptWebSelection): Promise<boolean> {
  const model = compact(selection.model)
  const wanted = selection.model === 'GPT-6 Pro' && selection.reasoning === null ? 'Pro' : selection.reasoning
  const family = ['gpt56sol', 'gpt56', 'sol'].includes(model) ? 'sol' : ['gpt6astra', 'gpt6', 'astra', 'gpt6pro'].includes(model) ? 'astra' : null
  if (!family || !wanted || !['Instant', 'Medium', 'High', 'Extra High', 'Pro'].includes(wanted) || family === 'astra' && wanted !== 'Pro') return false
  let saved: SavedSelection | null = null
  let success = false
  let closed = false
  try {
    saved = await capture(cdp, sessionId)
    if (!saved) return false
    const radio = family === 'sol' ? 'GPT-5.6 Sol' : 'Latest'
    if (!await chooseRadio(cdp, sessionId, radio)) return false
    const current = await inspect(cdp, sessionId)
    success = current.slider?.reasoning === wanted && identity(radio, current) === family
      || await scan(cdp, sessionId, state => state.slider?.reasoning === wanted && identity(radio, state) === family)
    if (!success) return false
    const confirmed = await selectedRadio(cdp, sessionId)
    const final = await view(cdp, sessionId, 'simple')
    success = !!final && radioKey(confirmed || '') === radioKey(radio) && final.slider?.reasoning === wanted && identity(confirmed!, final) === family
  } catch { success = false; return false }
  finally {
    if (!success && saved) await restore(cdp, sessionId, saved).catch(() => false)
    closed = await close(cdp, sessionId).catch(() => false)
  }
  return success && closed
}

export async function readChatGptIntelligenceModels(cdp: CdpTransport, sessionId: string): Promise<ChatGptWebModelOption[]> {
  let saved: SavedSelection | null = null
  let restored = false
  let closed = false
  const models: ChatGptWebModelOption[] = []
  try {
    saved = await capture(cdp, sessionId)
    if (!saved) return []
    for (const [radio, model, family] of [['GPT-5.6 Sol', 'GPT-5.6 Sol', 'sol'], ['Latest', 'GPT-6 Astra', 'astra']] as const) {
      if (!await chooseRadio(cdp, sessionId, radio)) continue
      const levels: string[] = []
      let complete = false, duplicate = false
      await scan(cdp, sessionId, state => {
        if (identity(radio, state) === family && state.slider) {
          if (levels.includes(state.slider.reasoning)) duplicate = true
          else levels.push(state.slider.reasoning)
        }
        complete = state.slider?.position === state.slider?.max
        return false
      })
      if (complete && !duplicate && levels.length) models.push({ model, reasoningOptions: levels })
    }
  } catch { models.length = 0 }
  finally {
    if (saved) restored = await restore(cdp, sessionId, saved).catch(() => false)
    closed = await close(cdp, sessionId).catch(() => false)
  }
  return restored && closed ? models : []
}
