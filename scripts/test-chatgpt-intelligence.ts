import assert from 'node:assert/strict'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const hostRequire = createRequire(path.resolve('package.json'))
const { buildSync } = hostRequire('esbuild') as typeof import('esbuild')
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
const levels = ['Instant', 'Medium', 'High', 'Extra High', 'Pro']
const chinese: Record<string, string> = { Instant: '即时', Medium: '中', High: '高', 'Extra High': '极高', Pro: 'Pro' }

class ElementFixture {
  parentElement: ElementFixture | null = null
  readonly children: ElementFixture[] = []
  readonly attributes: Record<string, string>
  readonly tagName: string
  hidden = false
  disabled = false
  constructor(tag: string, readonly text = '', attributes: Record<string, string> = {}, readonly rect = { x: 20, y: 20, width: 100, height: 24 }, readonly focusAction = () => {}) {
    this.tagName = tag.toUpperCase(); this.attributes = attributes
  }
  get id() { return this.attributes.id || '' }
  get innerText(): string { return this.text || this.children.map(node => node.innerText).join('\n') }
  get textContent(): string { return this.innerText }
  getAttribute(name: string) { return this.attributes[name] ?? null }
  append(node: ElementFixture) { node.parentElement = this; this.children.push(node); return node }
  all(): ElementFixture[] { return this.children.flatMap(node => [node, ...node.all()]) }
  contains(node: ElementFixture): boolean { return node === this || this.all().includes(node) }
  matches(selector: string): boolean {
    return selector.split(',').some(part => {
      const tag = part.trim().match(/^[a-z][\w-]*/i)?.[0]
      if (tag && this.tagName !== tag.toUpperCase()) return false
      return [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([,name,value]) => value === undefined ? name in this.attributes : this.attributes[name] === value)
    })
  }
  closest(selector: string): ElementFixture | null {
    for (let node: ElementFixture | null = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }
  querySelectorAll(selector: string) { return this.all().filter(node => node.matches(selector)) }
  getBoundingClientRect() {
    for (let node: ElementFixture | null = this; node; node = node.parentElement) if (node.hidden) return { ...this.rect, width: 0, height: 0 }
    // Inert inactive tracks still have geometry, as in animated production menus.
    return this.rect
  }
  focus() { assert(!this.closest('[inert],[data-active="false"]'), 'hidden view must not receive focus'); this.focusAction() }
  click() { throw new Error('Driver must click through CDP mouse input, not programmatic DOM click') }
}

interface FixtureOptions {
  language?: 'zh-CN' | 'en'
  radio?: string
  position?: number
  solLevels?: string[]
  malformedAnnouncement?: boolean
  nonModernMenu?: boolean
  missingSol?: boolean
  missingLatest?: boolean
  stuckSol?: boolean
  unknownSolLevel?: boolean
  brokenOwner?: boolean
  hideAstraBadge?: boolean
  closeAfterRadio?: boolean
  hoveredTrigger?: boolean
  closeDelayReads?: number
  closeStateOnRoot?: boolean
  dropSolProLeftCount?: number
  jumpSolProLeftOnce?: boolean
  blurAfterFocusOnce?: boolean
}
class CdpFixture {
  radio: string
  position: number
  opened = false
  view: 'simple' | 'advanced' = 'simple'
  focused = false
  closingReads = 0
  transitionClicks = 0
  droppedArrows = 0
  jumpedArrows = 0
  focusBlurred = false
  blurNextRead = false
  readonly events: { method: string; key?: unknown; action?: string }[] = []
  constructor(readonly options: FixtureOptions = {}) {
    this.radio = options.radio || 'latest'; this.position = options.position ?? 4
  }
  get currentLevels() { return this.radio === 'sol' ? this.options.solLevels || levels : levels }
  get currentReasoning() { return this.currentLevels[this.position] }
  get title() {
    const level = this.currentReasoning
    if (level === 'Pro') return this.radio === 'latest' ? this.options.hideAstraBadge ? 'Pro' : '6\nPro' : this.radio === 'sol' ? '5.6\nPro' : '5.5\nPro'
    return this.options.language === 'en' ? level : chinese[level] || level
  }
  buildDocument() {
    const body = new ElementFixture('body'), main = body.append(new ElementFixture('main'))
    const document: any = { activeElement: null, querySelectorAll: (selector: string) => body.querySelectorAll(selector), getElementById: (id: string) => body.all().find(node => node.id === id) || null }
    const trigger = main.append(new ElementFixture('button', this.options.hoveredTrigger && this.opened ? '思考强度' : this.title, { id: 'picker-trigger', 'aria-haspopup': 'menu', 'aria-expanded': String(this.opened), 'data-action': 'open' }, { x: 30, y: 20, width: 130, height: 30 }))
    // Bait in a prior message and an unrelated menu must never be touched.
    const article = main.append(new ElementFixture('article'))
    article.append(new ElementFixture('button', '6 Pro', { 'aria-haspopup': 'menu', 'data-action': 'forbidden' }))
    const other = body.append(new ElementFixture('div', '', { role: 'menu', 'aria-labelledby': 'other-trigger' }))
    other.append(new ElementFixture('button', 'GPT-5.6 Sol', { role: 'menuitemradio', 'aria-checked': 'true', 'data-action': 'forbidden' }))
    const menu = body.append(new ElementFixture('div', '', { role: 'menu', 'aria-labelledby': this.options.brokenOwner ? 'missing-trigger' : trigger.id,
      ...(this.options.closeStateOnRoot ? {} : { 'data-state': this.opened ? 'open' : 'closed' }) }))
    menu.hidden = !this.opened && this.closingReads === 0
    const content = menu.append(new ElementFixture('div', '', { 'data-testid': this.options.nonModernMenu ? 'unknown-picker' : 'composer-intelligence-picker-content',
      ...(this.options.closeStateOnRoot ? { 'data-state': this.opened ? 'open' : 'closed' } : {}) }))
    if (this.view === 'simple') content.append(new ElementFixture('div', this.title, { role: 'menuitem', 'aria-label': this.options.language === 'en' ? 'Choose model' : '选择模型', 'data-action': 'toggle' }, { x: 40, y: 70, width: 240, height: 30 }))
    const simple = content.append(new ElementFixture('div', '', { 'data-testid': 'composer-model-picker-slider-simple-view', 'data-active': String(this.view === 'simple'), ...(this.view === 'simple' ? {} : { inert: '' }) }))
    const sliderControl = simple.append(new ElementFixture('div', '', { role: 'menuitem', 'aria-keyshortcuts': 'ArrowLeft ArrowRight', 'aria-describedby': 'level-announcement instruction-announcement' }, { x: 40, y: 110, width: 240, height: 30 }, () => {
      this.focused = true; document.activeElement = sliderControl
      if (this.options.blurAfterFocusOnce && !this.focusBlurred) { this.blurNextRead = true; this.focusBlurred = true }
    }))
    sliderControl.append(new ElementFixture('span', '', { role: 'slider', 'aria-hidden': 'true', 'aria-valuenow': String(this.position), 'aria-valuemin': '0', 'aria-valuemax': String(this.currentLevels.length - 1) }))
    const visibleLevel = this.options.unknownSolLevel && this.radio === 'sol' && this.position === 1 ? 'Unrecognized mode' : this.options.language === 'en' ? this.currentReasoning : chinese[this.currentReasoning] || this.currentReasoning
    const announcement = this.options.malformedAnnouncement ? visibleLevel + ', unavailable'
      : this.options.language === 'en' ? `${visibleLevel}, ${this.position + 1} of ${this.currentLevels.length}.`
      : `${visibleLevel}，第 ${this.position + 1} 项，共 ${this.currentLevels.length} 项。`
    simple.append(new ElementFixture('span', announcement, { id: 'level-announcement' }))
    simple.append(new ElementFixture('span', 'Use Left and Right arrow keys.', { id: 'instruction-announcement' }))
    const advanced = content.append(new ElementFixture('div', '', { 'data-testid': 'composer-model-picker-slider-advanced-view', 'data-active': String(this.view === 'advanced'), ...(this.view === 'advanced' ? {} : { inert: '' }) }))
    const radios = [['latest', this.options.language === 'en' ? 'Latest' : '最新'], ['sol', 'GPT-5.6 Sol'], ['legacy', 'GPT-5.5\nRetiring soon']]
      .filter(([key]) => !(key === 'sol' && this.options.missingSol || key === 'latest' && this.options.missingLatest))
    radios.forEach(([key, title], index) => advanced.append(new ElementFixture('div', title, { role: 'menuitemradio', 'aria-checked': String(this.radio === key), 'data-action': 'radio:' + key }, { x: 40, y: 115 + index * 40, width: 240, height: 30 })))
    if (this.focused && this.opened && this.view === 'simple') document.activeElement = sliderControl
    return { body, document, env: { document, HTMLElement: ElementFixture, getComputedStyle: (node: ElementFixture) => ({ visibility: 'visible', display: node.hidden ? 'none' : 'block' }) } }
  }
  async send<T>(method: string, params: Record<string, any> = {}): Promise<T> {
    this.events.push({ method, key: params.key })
    if (method === 'Runtime.evaluate') {
      assert(!/fetch\(|__react|React|localStorage|sessionStorage|prompt-textarea/.test(params.expression), 'page expression must only inspect observed controls')
      if (this.blurNextRead) { this.focused = false; this.blurNextRead = false }
      const value = vm.runInNewContext(params.expression, this.buildDocument().env)
      if (this.closingReads > 0) this.closingReads--
      return { result: { value } } as T
    }
    if (method === 'Input.dispatchMouseEvent') {
      if (params.type !== 'mouseReleased') return {} as T
      if (this.closingReads > 0) { this.transitionClicks++; return {} as T }
      const tree = this.buildDocument()
      const node = tree.body.querySelectorAll('[data-action]').find(node => {
        const r = node.getBoundingClientRect()
        return !node.closest('[inert],[data-active="false"],article') && r.width && r.height && params.x >= r.x && params.x <= r.x + r.width && params.y >= r.y && params.y <= r.y + r.height
      })
      assert(node, 'mouse must target a visible control')
      const action = node.getAttribute('data-action')!
      assert.notEqual(action, 'forbidden')
      this.events.at(-1)!.action = action
      if (action === 'open') { this.opened = true; this.view = 'simple' }
      else if (action === 'toggle') { this.view = this.view === 'simple' ? 'advanced' : 'simple'; this.focused = false }
      else if (action.startsWith('radio:')) {
        assert.equal(this.view, 'advanced')
        if (this.radio !== action.slice(6)) this.position = 0 // Re-selecting the checked radio is a view operation.
        this.radio = action.slice(6)
        this.view = 'simple'; this.focused = false
        if (this.options.closeAfterRadio) { this.opened = false; this.closingReads = this.options.closeDelayReads || 0 }
      }
      return {} as T
    }
    if (method === 'Input.dispatchKeyEvent') {
      assert(['Escape', 'ArrowLeft', 'ArrowRight'].includes(params.key), 'driver may never send a chat message')
      if (params.type !== 'keyDown') return {} as T
      if (params.key === 'Escape') { if (this.opened) this.closingReads = this.options.closeDelayReads || 0; this.opened = false; this.focused = false; return {} as T }
      assert(this.opened && this.view === 'simple' && this.focused, 'arrow keys require the active visible slider menuitem')
      if (this.radio === 'sol' && this.currentReasoning === 'Pro' && params.key === 'ArrowLeft'
        && this.droppedArrows < (this.options.dropSolProLeftCount || 0)) {
        // The live Pro -> Medium failure kept position 4 through every read after
        // the first left key, while focused changed from true to false.
        this.droppedArrows++; this.focused = false; return {} as T
      }
      if (this.options.jumpSolProLeftOnce && this.radio === 'sol' && this.currentReasoning === 'Pro' && params.key === 'ArrowLeft' && this.jumpedArrows === 0) {
        this.jumpedArrows++; this.position -= 2; this.focused = false; return {} as T
      }
      if (!(this.options.stuckSol && this.radio === 'sol')) this.position = Math.max(0, Math.min(this.currentLevels.length - 1, this.position + (params.key === 'ArrowLeft' ? -1 : 1)))
      this.focused = false // The driver must focus the freshly observed control again before every step.
      return {} as T
    }
    throw new Error('Unexpected CDP method: ' + method)
  }
}

function loadCompiled(minify: boolean) {
  const source = buildSync({ entryPoints: [path.resolve('src/main/chatgptIntelligence.ts')], write: false, bundle: true,
    platform: 'node', format: 'cjs', target: 'es2020', minify, logLevel: 'silent' }).outputFiles[0].text
  const module = { exports: {} as any }
  vm.runInNewContext(source, { module, exports: module.exports, setTimeout: (callback: () => void) => { queueMicrotask(callback); return 0 } })
  return module.exports as typeof import('../src/main/chatgptIntelligence')
}

async function main() {
  for (const minify of [false, true]) {
    const driver = loadCompiled(minify)
    for (const language of ['zh-CN', 'en'] as const) {
      const fixture = new CdpFixture({ language })
      assert.equal(await driver.detectChatGptIntelligence(fixture, 'fixture'), true)
      assert.equal(fixture.opened, false)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4)
      const models = await driver.readChatGptIntelligenceModels(fixture, 'fixture')
      assert.deepEqual(plain(models), [
        { model: 'GPT-5.6 Sol', reasoningOptions: levels },
        { model: 'GPT-6 Astra', reasoningOptions: ['Pro'] },
      ])
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4); assert.equal(fixture.opened, false)
      assert(fixture.events.some(event => event.action === 'radio:sol'), 'model reading actually activates an explicit family')
      assert(fixture.events.some(event => event.key === 'ArrowRight'), 'slider positions are inspected and restored through input')
      for (const reasoning of levels) {
        assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning }), true)
        assert.equal(fixture.radio, 'sol'); assert.equal(fixture.currentReasoning, reasoning); assert.equal(fixture.opened, false)
      }
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-6 Astra', reasoning: 'Pro' }), true)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4); assert.equal(fixture.opened, false)
      const unchanged = fixture.events.length
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-6 Astra', reasoning: 'Extra High' }), false)
      assert.equal(fixture.events.length, unchanged, 'unproven Latest lower levels are never treated as Astra')
    }
    {
      for (const language of ['zh-CN', 'en'] as const) {
        const fixture = new CdpFixture({ language, position: 1, hoveredTrigger: true, dropSolProLeftCount: 1, blurAfterFocusOnce: true })
        for (const selection of [
          { model: 'GPT-5.6 Sol', reasoning: 'Pro' },
          { model: 'GPT-5.6 Sol', reasoning: 'Medium' },
          { model: 'GPT-6 Astra', reasoning: 'Pro' },
        ]) {
          assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', selection), true, `focus loss must not break ${selection.model} / ${selection.reasoning}`)
          assert.equal(fixture.currentReasoning, selection.reasoning)
          assert.equal(fixture.radio, selection.model === 'GPT-5.6 Sol' ? 'sol' : 'latest')
          assert.equal(fixture.opened, false)
        }
        assert.equal(fixture.droppedArrows, 1, 'regression includes the ignored Pro-left key from the live trace')
        assert.equal(fixture.focusBlurred, true, 'focus is independently lost between the focus call and the next read')
      }
    }
    {
      const fixture = new CdpFixture({ radio: 'sol', position: 4, dropSolProLeftCount: 20 })
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning: 'Medium' }), false)
      assert.equal(fixture.droppedArrows, 2, 'persistent focus loss permits only one retry')
      assert.equal(fixture.radio, 'sol'); assert.equal(fixture.position, 4); assert.equal(fixture.opened, false)
    }
    {
      const fixture = new CdpFixture({ radio: 'sol', position: 4, jumpSolProLeftOnce: true })
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning: 'Medium' }), false)
      assert.equal(fixture.jumpedArrows, 1)
      assert.equal(fixture.events.filter(event => event.method === 'Input.dispatchKeyEvent' && event.key === 'ArrowLeft').length, 2,
        'an unexpected two-slot movement is not retried; only one left key-down/up pair was sent')
      assert.equal(fixture.radio, 'sol'); assert.equal(fixture.position, 4); assert.equal(fixture.opened, false, 'unexpected movement restores the original selection')
    }
    {
      for (const closeStateOnRoot of [false, true]) {
        const fixture = new CdpFixture({ closeDelayReads: 4, closeStateOnRoot, closeAfterRadio: true, hoveredTrigger: true })
        assert.equal(await driver.detectChatGptIntelligence(fixture, 'fixture'), true)
        assert.equal(fixture.closingReads, 0, 'detection does not return during the close transition')
        for (const selection of [
          { model: 'GPT-5.6 Sol', reasoning: 'Pro' },
          { model: 'GPT-5.6 Sol', reasoning: 'Medium' },
          { model: 'GPT-5.6 Sol', reasoning: 'Medium' },
          { model: 'GPT-6 Astra', reasoning: 'Pro' },
        ]) {
          assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', selection), true)
          assert.equal(fixture.currentReasoning, selection.reasoning)
          assert.equal(fixture.opened, false); assert.equal(fixture.closingReads, 0)
        }
        assert.equal(plain(await driver.readChatGptIntelligenceModels(fixture, 'fixture')).length, 2)
        assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4); assert.equal(fixture.closingReads, 0)
        assert.equal(fixture.transitionClicks, 0, 'no click is sent into a fading popover')
      }
    }
    {
      const fixture = new CdpFixture({ hoveredTrigger: true, position: 1 })
      assert.deepEqual(plain(await driver.readChatGptIntelligenceModels(fixture, 'fixture')), [
        { model: 'GPT-5.6 Sol', reasoningOptions: levels },
        { model: 'GPT-6 Astra', reasoningOptions: ['Pro'] },
      ], 'the associated inner 6 Pro badge proves Astra even while the outer pill shows a hover hint')
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 1); assert.equal(fixture.opened, false)
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-6 Astra', reasoning: 'Pro' }), true)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4)
    }
    {
      const fixture = new CdpFixture({ radio: 'sol', position: 3, closeAfterRadio: true })
      assert.equal(plain(await driver.readChatGptIntelligenceModels(fixture, 'fixture')).length, 2)
      assert.equal(fixture.radio, 'sol'); assert.equal(fixture.position, 3); assert.equal(fixture.opened, false)
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-6 Astra', reasoning: 'Pro' }), true)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4)
    }
    {
      const fixture = new CdpFixture({ radio: 'legacy', position: 2, solLevels: ['High', 'Instant', 'Pro', 'Medium', 'Extra High'] })
      const models = await driver.readChatGptIntelligenceModels(fixture, 'fixture')
      assert.deepEqual(plain(models)[0].reasoningOptions, ['High', 'Instant', 'Pro', 'Medium', 'Extra High'])
      assert.equal(fixture.radio, 'legacy'); assert.equal(fixture.position, 2, 'read restores even an unlisted original family')
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning: 'Medium' }), true)
      assert.equal(fixture.position, 3, 'announced label, not a hardcoded slot, determines the target')
    }
    for (const options of [{ malformedAnnouncement: true }, { nonModernMenu: true }, { brokenOwner: true }]) {
      const fixture = new CdpFixture(options)
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning: 'High' }), false)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4); assert.equal(fixture.opened, false)
      assert(fixture.events.length < 80, 'unsupported markup is bounded')
    }
    {
      const fixture = new CdpFixture({ radio: 'sol', position: 2, missingLatest: true })
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-6 Astra', reasoning: 'Pro' }), false)
      assert.equal(fixture.radio, 'sol'); assert.equal(fixture.position, 2); assert.equal(fixture.opened, false)
    }
    {
      const fixture = new CdpFixture({ unknownSolLevel: true })
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning: 'High' }), false)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4, 'an unknown announcement rolls back the attempted selection')
      const models = await driver.readChatGptIntelligenceModels(fixture, 'fixture')
      assert.deepEqual(plain(models), [{ model: 'GPT-6 Astra', reasoningOptions: ['Pro'] }])
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4)
    }
    {
      const fixture = new CdpFixture({ stuckSol: true })
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-5.6 Sol', reasoning: 'High' }), false)
      assert.equal(fixture.radio, 'latest'); assert.equal(fixture.position, 4)
      assert(fixture.events.length < 200, 'a nonresponsive slider never causes an unbounded retry')
    }
    {
      const fixture = new CdpFixture({ hideAstraBadge: true })
      assert.equal(await driver.selectChatGptIntelligence(fixture, 'fixture', { model: 'GPT-6 Astra', reasoning: 'Pro' }), false)
      assert(!plain(await driver.readChatGptIntelligenceModels(fixture, 'fixture')).some((model: any) => model.model === 'GPT-6 Astra'), 'Latest plus a bare Pro label is insufficient identity evidence')
    }
  }
  console.log('chatgpt-intelligence: stateful CDP/DOM fixtures pass in readable and minified bundles; visible-view ownership, live announcement scanning, all explicit Sol levels, Latest 6 Pro, Pro-to-Medium focus recovery, restoration and bounded failures verified; no real website or account used')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
