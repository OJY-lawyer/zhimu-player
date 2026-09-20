import assert from 'node:assert/strict'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import type { ChatGptWebSelection } from '../src/shared/contracts'
import { translateRuntimeMessage } from '../src/shared/runtimeMessages'

const hostRequire = createRequire(path.resolve('package.json'))
const { buildSync } = hostRequire('esbuild') as typeof import('esbuild')
const sol = { model: 'GPT-5.6 Sol', reasoning: 'Medium' }
const solPro = { model: 'GPT-5.6 Sol', reasoning: 'Pro' }
const astra = { model: 'GPT-6 Astra', reasoning: 'Pro' }

/** Minimal DOM fixture, deliberately independent of the generated page expression. */
class FixtureElement {
  readonly tagName: string
  readonly children: FixtureElement[] = []
  parentElement: FixtureElement | null = null
  readonly attributes = new Map<string, string>()
  text = ''
  hidden = false
  disabled = false
  clicks = 0
  onClick = () => {}
  constructor(tag: string, text = '', attributes: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase(); this.text = text
    for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value)
  }
  get id() { return this.attributes.get('id') || '' }
  get innerText() { return this.text || this.children.map(node => node.innerText).join('\n') }
  get textContent(): string { return this.innerText }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  append(node: FixtureElement) { node.parentElement = this; this.children.push(node); return node }
  all(): FixtureElement[] { return this.children.flatMap(node => [node, ...node.all()]) }
  matches(selector: string) {
    return selector.split(',').some(part => {
      part = part.trim()
      const tag = part.match(/^[a-z][\w-]*/i)?.[0]
      if (tag && this.tagName !== tag.toUpperCase()) return false
      const attributes = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
      return attributes.every(([, key, value]) => value === undefined ? this.attributes.has(key) : this.attributes.get(key) === value)
    })
  }
  closest(selector: string): FixtureElement | null {
    for (let node: FixtureElement | null = this; node; node = node.parentElement) if (node.matches(selector)) return node
    return null
  }
  querySelectorAll(selector: string) { return this.all().filter(node => node.matches(selector)) }
  getBoundingClientRect() {
    let hidden = false
    for (let node: FixtureElement | null = this; node; node = node.parentElement) if (node.hidden) hidden = true
    return { width: hidden ? 0 : 100, height: hidden ? 0 : 28 }
  }
  click() { this.clicks++; this.onClick() }
}

function page() {
  const body = new FixtureElement('body')
  const main = body.append(new FixtureElement('main'))
  const document = {
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
    getElementById: (id: string) => body.all().find(node => node.id === id) || null,
  }
  const context = vm.createContext({ document, HTMLElement: FixtureElement,
    getComputedStyle: (node: FixtureElement) => ({ display: node.hidden ? 'none' : 'block', visibility: 'visible' }),
  })
  function popup(kind: 'model' | 'reasoning', title: string) {
    const control = main.append(new FixtureElement('button', title, { id: kind + '-control',
      'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': kind + '-menu',
      'aria-label': kind === 'model' ? 'Model picker' : 'Reasoning level',
      'data-testid': kind === 'model' ? 'model-switcher-dropdown-button' : 'thinking-level-button',
    }))
    const menu = body.append(new FixtureElement('div', '', { id: kind + '-menu', role: 'menu' }))
    menu.hidden = true
    control.onClick = () => { control.setAttribute('aria-expanded', 'true'); menu.hidden = false }
    const option = (title: string, selected = false) => {
      const item = menu.append(new FixtureElement('button', title, { role: 'menuitemradio', 'aria-checked': String(selected) }))
      item.onClick = () => {
        for (const sibling of menu.children) sibling.setAttribute('aria-checked', String(sibling === item))
        control.text = title.split('\n')[0]
        control.setAttribute('aria-expanded', 'false'); menu.hidden = true
      }
      return item
    }
    return { control, menu, option }
  }
  return { body, main, popup, run(expression: string) { return JSON.parse(JSON.stringify(vm.runInContext(expression, context))) } }
}

function loadCompiled(minify: boolean) {
  // Exercise the actual serialized helper after both readable and production-style bundling.
  const compiled = buildSync({ entryPoints: [path.resolve('src/main/chatgptModelPage.ts')], write: false, bundle: true,
    platform: 'node', format: 'cjs', target: 'es2020', minify, logLevel: 'silent' }).outputFiles[0].text
  const module = { exports: {} as any }
  vm.runInNewContext(compiled, { module, exports: module.exports })
  return module.exports as typeof import('../src/main/chatgptModelPage')
}

for (const minify of [false, true]) {
  const helper = loadCompiled(minify)
  const inspect = (fixture: ReturnType<typeof page>, kind: 'model' | 'reasoning', action: 'read' | 'open' | 'choose' | 'check', selection: ChatGptWebSelection) =>
    fixture.run(helper.modelControlExpression(kind, action, selection))
  {
    const fixture = page(), model = fixture.popup('model', 'GPT-5.6 Sol')
    model.option('GPT-5.6 Sol\nA model description', true)
    const pro = model.option('Astra Pro')
    const disabled = model.option('GPT-99'); disabled.setAttribute('aria-disabled', 'true')
    assert.equal(inspect(fixture, 'model', 'read', sol).matched, true)
    assert.equal(model.control.clicks, 0, 'reading never mutates a control')
    assert.deepEqual(inspect(fixture, 'model', 'read', sol).options, [])
    inspect(fixture, 'model', 'open', sol)
    assert.deepEqual(inspect(fixture, 'model', 'read', sol).options, ['GPT-5.6 Sol', 'Astra Pro'])
    inspect(fixture, 'model', 'choose', astra)
    assert.equal(pro.clicks, 1)
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', astra).matched, true, 'the combined family/Pro label proves both choices without inventing another control')
    assert.equal(inspect(fixture, 'model', 'check', sol).matched, false)
  }
  {
    const fixture = page(), model = fixture.popup('model', 'Thinking'), reasoning = fixture.popup('reasoning', 'Standard')
    reasoning.option('Standard', true); const high = reasoning.option('Extended'); reasoning.option('Heavy')
    assert.equal(inspect(fixture, 'model', 'check', sol).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', sol).matched, true)
    inspect(fixture, 'reasoning', 'open', sol)
    inspect(fixture, 'reasoning', 'choose', { ...sol, reasoning: 'High' })
    assert.equal(high.clicks, 1)
    assert.equal(inspect(fixture, 'reasoning', 'check', { ...sol, reasoning: 'High' }).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', sol).matched, false)
    reasoning.control.hidden = true; model.control.text = 'Instant'
    assert.equal(inspect(fixture, 'model', 'check', { ...sol, reasoning: 'Instant' }).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', { ...sol, reasoning: 'Instant' }).matched, true)
    assert.equal(inspect(fixture, 'model', 'check', sol).matched, false)
    model.control.text = 'Pro'
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, false, 'bare Pro is not evidence of Astra')
  }
  {
    const fixture = page(), model = fixture.popup('model', 'Model')
    model.option('GPT-6 Pro', true)
    const bare = model.option('Pro')
    inspect(fixture, 'model', 'open', astra)
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, true, 'a linked selected radio can identify a generic control')
    assert(!inspect(fixture, 'model', 'read', astra).options.includes('Pro'))
    inspect(fixture, 'model', 'choose', { model: 'Pro', reasoning: null })
    assert.equal(bare.clicks, 0)
  }
  {
    const fixture = page(), model = fixture.popup('model', 'GPT-5.6 Sol')
    model.option('GPT-5.6 Sol', true); model.option('GPT-6 Pro', true)
    inspect(fixture, 'model', 'open', sol)
    assert.equal(inspect(fixture, 'model', 'check', sol).matched, false, 'contradictory selected radios are inconclusive')
  }
  {
    const fixture = page(), model = fixture.popup('model', 'GPT-5.6 Sol')
    const article = fixture.main.append(new FixtureElement('article'))
    article.append(new FixtureElement('button', 'GPT-6 Pro', { 'aria-haspopup': 'menu', 'data-testid': 'model-switcher', 'aria-expanded': 'true' }))
    const unlinked = fixture.body.append(new FixtureElement('div', '', { role: 'menu' }))
    const unrelated = unlinked.append(new FixtureElement('button', 'GPT-6 Pro', { role: 'menuitemradio', 'aria-checked': 'true' }))
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, false)
    inspect(fixture, 'model', 'choose', astra)
    assert.equal(unrelated.clicks, 0)
    model.control.hidden = true
    assert.equal(inspect(fixture, 'model', 'check', astra).available, false)
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, false, 'selected items without a real model control are not evidence')
  }
  {
    const fixture = page(), model = fixture.popup('model', 'GPT-5.6 Sol')
    const pro = model.option('GPT-6 Pro')
    model.control.removeAttribute('aria-controls')
    model.control.setAttribute('aria-expanded', 'true'); model.menu.hidden = false
    inspect(fixture, 'model', 'choose', astra)
    assert.equal(pro.clicks, 0, 'an already-open unlinked portal menu fails closed')
    model.menu.setAttribute('aria-labelledby', model.control.id)
    inspect(fixture, 'model', 'choose', astra)
    assert.equal(pro.clicks, 1, 'aria-labelledby explicitly associates a portal menu')
  }
  {
    const fixture = page(), model = fixture.popup('model', 'GPT-5.6 Sol')
    const more = model.option('More models'); more.setAttribute('aria-haspopup', 'menu')
    const nested = model.menu.append(new FixtureElement('div', '', { role: 'menu' }))
    const nestedPro = nested.append(new FixtureElement('button', 'GPT-6 Pro', { role: 'menuitemradio' }))
    inspect(fixture, 'model', 'open', astra)
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, [])
    inspect(fixture, 'model', 'choose', astra)
    assert.equal(more.clicks + nestedPro.clicks, 0, 'More models traversal is unsupported, never guessed')
  }
  {
    const fixture = page(), model = fixture.popup('model', 'GPT-5.6 Sol')
    const first = model.option('GPT-6 Pro'), second = model.option('Astra Pro')
    inspect(fixture, 'model', 'open', astra); inspect(fixture, 'model', 'choose', astra)
    assert.equal(first.clicks + second.clicks, 0, 'ambiguous equivalent options are not chosen arbitrarily')
    fixture.main.append(new FixtureElement('button', 'GPT-6 Pro', { 'data-testid': 'model-switcher', 'aria-haspopup': 'menu' }))
    assert.equal(inspect(fixture, 'model', 'check', astra).available, false, 'two model controls are inconclusive')
  }
  {
    const fixture = page(), reasoning = fixture.popup('reasoning', '中')
    assert.equal(inspect(fixture, 'reasoning', 'check', sol).matched, true)
    reasoning.control.text = '极高'
    assert.equal(inspect(fixture, 'reasoning', 'check', { ...sol, reasoning: 'Extra High' }).matched, true)
    reasoning.control.text = 'Whatever'
    inspect(fixture, 'reasoning', 'open', sol)
    assert.equal(inspect(fixture, 'reasoning', 'check', sol).matched, false)
  }
  for (const [badge, selected, other] of [['5.6\nPro', solPro, astra], ['6\nPro', astra, solPro]] as const) {
    const fixture = page()
    const control = fixture.main.append(new FixtureElement('button', badge, { 'aria-haspopup': 'menu' }))
    assert.equal(inspect(fixture, 'model', 'check', selected).available, true, 'combined labels identify a picker without test IDs or ARIA labels')
    assert.equal(inspect(fixture, 'model', 'check', selected).label, badge.replace('\n', ' '), 'the full badge is retained')
    assert.equal(inspect(fixture, 'model', 'check', selected).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', selected).matched, true)
    assert.equal(inspect(fixture, 'model', 'check', other).matched, false)
    assert.equal(inspect(fixture, 'reasoning', 'check', other).matched, false, 'Pro evidence belongs to its own model family')
    assert.equal(inspect(fixture, 'reasoning', 'check', { ...selected, reasoning: 'Extra High' }).matched, false)
    assert.equal(control.clicks, 0)
    control.text = 'Pro'
    assert.equal(inspect(fixture, 'model', 'check', selected).matched, false, 'bare Pro has no family evidence')
    assert.equal(inspect(fixture, 'reasoning', 'check', selected).matched, true, 'a bare level can prove reasoning but cannot supply missing model evidence')
  }
  {
    const fixture = page()
    const control = fixture.main.append(new FixtureElement('button', '6\nPro', { 'aria-haspopup': 'menu' }))
    const unrelatedMenu = fixture.body.append(new FixtureElement('div', '', { role: 'menu' }))
    const unrelated = unrelatedMenu.append(new FixtureElement('button', 'GPT-5.6 Sol', { role: 'menuitemradio', 'aria-checked': 'true' }))
    const menu = fixture.body.append(new FixtureElement('div', '', { role: 'menu' })); menu.hidden = true
    const solOption = menu.append(new FixtureElement('button', 'GPT-5.6 Sol', { role: 'menuitemradio' }))
    menu.append(new FixtureElement('button', 'GPT-5.5', { role: 'menuitemradio' }))
    control.onClick = () => { menu.hidden = false }
    solOption.onClick = () => { control.text = '5.6\nPro'; menu.hidden = true }
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, [], 'pre-existing unrelated menus have no owner')
    inspect(fixture, 'model', 'open', solPro)
    assert.deepEqual(inspect(fixture, 'model', 'read', solPro).options, ['GPT-5.6 Sol', 'GPT-5.5'], 'the unique newly shown menu belongs to the clicked control')
    inspect(fixture, 'model', 'choose', solPro)
    assert.equal(solOption.clicks, 1)
    assert.equal(unrelated.clicks, 0, 'an existing menu cannot steal the newly associated control')
    assert.equal(inspect(fixture, 'model', 'check', solPro).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', solPro).matched, true)
  }
  {
    const fixture = page(), model = fixture.popup('model', '6\nPro')
    model.control.removeAttribute('aria-controls')
    const first = model.option('GPT-5.6 Sol')
    const otherMenu = fixture.body.append(new FixtureElement('div', '', { role: 'menu' })); otherMenu.hidden = true
    const second = otherMenu.append(new FixtureElement('button', 'GPT-5.6 Sol', { role: 'menuitemradio' }))
    model.control.onClick = () => { model.control.setAttribute('aria-expanded', 'true'); model.menu.hidden = false; otherMenu.hidden = false }
    inspect(fixture, 'model', 'open', solPro)
    inspect(fixture, 'model', 'choose', solPro)
    assert.equal(first.clicks + second.clicks, 0, 'two menus appearing after one click are inconclusive')
    otherMenu.hidden = true
    inspect(fixture, 'model', 'choose', solPro)
    assert.equal(first.clicks, 0, 'an ambiguous observation cannot later become an invented owner')
  }
  {
    const fixture = page(), reasoning = fixture.popup('reasoning', 'Reasoning')
    const slider = reasoning.menu.append(new FixtureElement('span', '', { role: 'slider', 'aria-valuenow': '4', 'aria-valuemin': '0', 'aria-valuemax': '4' }))
    inspect(fixture, 'reasoning', 'open', solPro)
    assert.equal(inspect(fixture, 'reasoning', 'check', solPro).matched, false, 'the maximum numeric slider position is not assumed to be Pro')
    slider.setAttribute('aria-valuetext', 'Extra High')
    assert.equal(inspect(fixture, 'reasoning', 'check', { ...sol, reasoning: 'Extra High' }).matched, true)
    assert.equal(inspect(fixture, 'reasoning', 'check', solPro).matched, false)
    slider.setAttribute('aria-valuetext', 'Pro')
    assert.equal(inspect(fixture, 'reasoning', 'check', solPro).matched, true)
    assert.equal(slider.clicks, 0, 'the helper does not guess or click slider coordinates')
  }
  {
    const fixture = page(), model = fixture.popup('model', '6\nPro')
    model.menu.append(new FixtureElement('span', '', { role: 'slider', 'aria-valuetext': 'Extra High' }))
    inspect(fixture, 'model', 'open', astra)
    assert.equal(inspect(fixture, 'reasoning', 'check', astra).matched, false, 'conflicting slider and badge evidence is inconclusive')
    assert.equal(inspect(fixture, 'reasoning', 'check', { ...astra, reasoning: 'Extra High' }).matched, false)
  }
  {
    // Reproduce the inspected intelligence picker: the advanced model view is
    // present with normal geometry but inert until its own navigation is used.
    const fixture = page(), model = fixture.popup('model', '6\nPro')
    model.control.removeAttribute('data-testid'); model.control.removeAttribute('aria-label'); model.control.removeAttribute('aria-controls')
    model.menu.setAttribute('aria-labelledby', model.control.id)
    const toggle = model.menu.append(new FixtureElement('div', '6 Pro', { role: 'menuitem', 'aria-label': '选择模型', 'aria-expanded': 'false' }))
    model.menu.append(new FixtureElement('span', '', { role: 'slider', 'aria-hidden': 'true', 'aria-valuetext': 'Extra High', 'aria-valuenow': '4' }))
    const advanced = model.menu.append(new FixtureElement('div', '', { inert: '', 'data-active': 'false', 'data-testid': 'composer-model-picker-slider-advanced-view' }))
    advanced.append(new FixtureElement('div', '最新', { role: 'menuitemradio', 'aria-checked': 'true' }))
    const hiddenSol = advanced.append(new FixtureElement('div', 'GPT-5.6 Sol', { role: 'menuitemradio' }))
    inspect(fixture, 'model', 'open', astra)
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, [], 'inert advanced choices and the view toggle are not model options')
    assert.equal(inspect(fixture, 'reasoning', 'check', astra).matched, true, 'an aria-hidden slider cannot contradict the visible badge')
    inspect(fixture, 'model', 'choose', solPro)
    assert.equal(hiddenSol.clicks + toggle.clicks, 0)
    advanced.removeAttribute('inert')
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, [], 'data-active=false remains excluded during a view transition')
    advanced.setAttribute('data-active', 'true')
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, ['GPT-5.6 Sol'])
    advanced.setAttribute('aria-hidden', 'true')
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, [], 'aria-hidden ancestors exclude every nested option')
  }
  for (const attributes of [{ inert: '' }, { 'aria-hidden': 'true' }, { 'data-active': 'false' }]) {
    const fixture = page()
    fixture.main.append(new FixtureElement('button', '6\nPro', { 'aria-haspopup': 'menu' }))
    const hidden = fixture.main.append(new FixtureElement('div', '', attributes))
    hidden.append(new FixtureElement('button', 'GPT-5.6 Sol', { 'aria-haspopup': 'menu', 'data-testid': 'model-switcher' }))
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, true, 'hidden controls cannot override the visible combined picker')
  }
  {
    const fixture = page(), model = fixture.popup('model', 'Model')
    model.option('6\nPro', true)
    inspect(fixture, 'model', 'open', astra)
    assert.deepEqual(inspect(fixture, 'model', 'read', astra).options, ['6 Pro'], 'combined menu labels also retain the family and level')
    assert.equal(inspect(fixture, 'model', 'check', astra).matched, true)
  }
  assert.equal(helper.answerModelMatches(sol, 'gpt-5.6-sol', 'standard'), true)
  assert.equal(helper.answerModelMatches(sol, 'gpt-5.6-thinking', 'high'), false)
  assert.equal(helper.answerModelMatches(sol, 'gpt-5.6-instant'), false)
  assert.equal(helper.answerModelMatches({ ...sol, reasoning: 'Instant' }, 'gpt-5.6-instant'), true)
  assert.equal(helper.answerModelMatches({ ...sol, reasoning: 'Instant' }, 'gpt-5.6-thinking'), false)
  assert.equal(helper.answerModelMatches({ ...sol, reasoning: 'Instant' }, 'gpt-5.6-sol', 'none'), false, 'API effort none is not assumed to mean website Instant')
  assert.equal(helper.answerModelMatches(astra, 'gpt-6-pro'), true)
  assert.equal(helper.answerModelMatches(astra, 'gpt-6-astra-pro'), true)
  assert.equal(helper.answerModelMatches(astra, 'gpt-6-astra'), false, 'a family name alone is not proof of Pro')
  assert.equal(helper.answerModelMatches(astra, 'gpt-6-astra', 'pro'), true)
  assert.equal(helper.answerModelMatches(astra, 'gpt-6-pro', 'high'), false, 'contradictory service effort cannot be ignored')
  assert.equal(helper.answerModelMatches(solPro, 'gpt-5.6-pro'), true)
  assert.equal(helper.answerModelMatches(solPro, 'gpt-5.6-sol-pro'), true)
  assert.equal(helper.answerModelMatches(solPro, 'gpt-5.6-sol', 'pro'), true)
  assert.equal(helper.answerModelMatches(solPro, 'gpt-5.6-sol'), false, 'a Sol family name alone is not proof of Pro')
  assert.equal(helper.answerModelMatches(solPro, 'gpt-5.6-pro', 'medium'), false)
  assert.equal(helper.answerModelMatches(solPro, 'gpt-6-pro'), false)
  assert.equal(helper.answerModelMatches(astra, 'gpt-5.6-pro'), false)
  assert.equal(helper.answerModelMatches(sol, 'gpt-5.6-pro'), false, 'a Pro slug cannot prove an ordinary level')
  assert.equal(helper.answerModelMatches({ ...astra, reasoning: 'Extra High' }, 'gpt-6-pro'), false)
  assert.equal(helper.answerModelMatches({ model: 'GPT-6 Pro', reasoning: null }, 'gpt-6-pro'), true, 'the known legacy representation keeps its Pro meaning')
  assert.equal(helper.answerModelMatches(astra, 'gpt-5.6-sol', 'medium'), false)
  assert.equal(helper.answerModelMatches({ model: 'Pro', reasoning: null }, 'gpt-6-pro'), false)
  assert.equal(helper.answerModelMatches(sol, ''), false)
  assert.equal(helper.answerModelMatches(sol, 'gpt-5.6-sol-unknown-suffix'), false)
  assert.equal(helper.answerModelMatches({ model: 'GPT-6 Astra', reasoning: 'xhigh' }, 'gpt-6-astra', 'xhigh'), true)
  assert.equal(helper.answerModelMatches({ model: 'GPT-6 Astra', reasoning: 'xhigh' }, 'gpt-6-astra-unknown', 'xhigh'), false)
}
for (const message of [
  '暂时无法确认 ChatGPT 登录状态，请稍后检查；无需立即重新登录。',
  'ChatGPT 要求进行人机验证，请在浏览器中手动完成后再检查。',
  'ChatGPT 尚未登录，请在设置中登录或导入 Cookie。',
  '检查 ChatGPT 登录状态超时，请稍后重试。',
  '无法确认所选网页模型或推理档位。请刷新网页选项或在登录窗口核对；未发送字幕。',
  '已读取当前网页可用选项。请选择模型和推理档位；生成前会再次确认。',
  '当前网页菜单无法可靠读取，请打开登录窗口核对；已有选择已保留。',
  '本次回复的模型与所选设置不符，或网页未提供可核验的模型信息，导读未保存。请在 ChatGPT 中核对这次对话。',
  '请先在设置中选择 ChatGPT 网页模型和推理档位。',
  '已取消导入，原有登录资料未更改。',
  'Cookie 导出内容不是有效的 JSON，请重新导出。',
  '请选择 Cookie-Editor 导出的 JSON 数组或 cookies 列表。',
  'Cookie 条目过多，请只导出 ChatGPT 网站的 Cookie。',
  '无法核对 Cookie 有效期，请检查系统时间。',
  '没有找到可导入的 ChatGPT Cookie，请从已登录的 ChatGPT 页面重新导出。',
  '导入或检查连接未完成。请关闭专用登录窗口、检查网络后重试；原浏览器不受影响。',
]) {
  assert.equal(translateRuntimeMessage(message, 'zh-CN'), message)
  assert(!/\p{Script=Han}/u.test(translateRuntimeMessage(message, 'en')), 'Fixed application status must be translated: ' + message)
}
const imported = translateRuntimeMessage('已导入 12 条 ChatGPT Cookie。ChatGPT 登录成功。模型与思考档位会在生成前核验。', 'en')
assert(imported.startsWith('Imported 12 ChatGPT cookie(s).'))
assert(!/\p{Script=Han}/u.test(imported))
assert(!/\p{Script=Han}/u.test(translateRuntimeMessage("Error invoking remote method 'chatgpt-import-cookies': Error: 已导入 2 条 ChatGPT Cookie。检查 ChatGPT 登录状态超时，请稍后重试。", 'en')))
console.log('chatgpt-model-page: isolated DOM/VM fixtures pass after readable and minified esbuild bundling; combined Sol/Astra Pro badges, inert/hidden controls, owned portal menus, explicit slider labels and response model/effort evidence checked; no real website/account used')
