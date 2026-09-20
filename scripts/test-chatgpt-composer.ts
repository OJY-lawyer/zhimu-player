import assert from 'node:assert/strict'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import type { ChatGptComposerState } from '../src/main/chatgptComposer'

const { buildSync } = createRequire(path.resolve('package.json'))('esbuild') as typeof import('esbuild')
const task = '请根据下面任务生成内容导读。\n\n# 合成任务\n[P1-00:00:02] 第一个话题\n[P1-00:00:08] 最后一段必须完整保留。'

class FixtureEvent {
  defaultPrevented = false
  readonly type: string
  readonly clipboardData?: FixtureDataTransfer
  readonly bubbles?: boolean
  readonly data?: string
  constructor(type: string, options: Record<string, unknown> = {}) { this.type = type; Object.assign(this, options) }
  preventDefault() { this.defaultPrevented = true }
}
class FixtureDataTransfer {
  values = new Map<string, string>()
  setData(type: string, value: string) { this.values.set(type, value) }
  getData(type: string) { return this.values.get(type) || '' }
}
type TextNode = { nodeType: number; nodeValue: string; parentNode: FixtureElement | null }
class FixtureElement {
  nodeType = 1
  nodeValue = null
  childNodes: (FixtureElement | TextNode)[] = []
  parentNode: FixtureElement | null = null
  isContentEditable = true
  hidden = false
  ariaHidden = false
  display = 'block'
  opacity = '1'
  focuses = 0
  events: FixtureEvent[] = []
  classNames = new Set<string>()
  classList = { contains: (name: string) => this.classNames.has(name) }
  onFocus = () => {}
  onEvent = (_event: FixtureEvent) => {}
  constructor(readonly tagName = 'DIV') {}
  get innerText(): string { return this.childNodes.map(node => node.nodeType === 3 ? node.nodeValue : (node as FixtureElement).innerText).join(this.tagName === 'DIV' ? '\n\n' : '') }
  getBoundingClientRect() { return { width: this.hidden ? 0 : 400, height: this.hidden ? 0 : 100 } }
  closest() { return this.ariaHidden ? this : null }
  focus() { this.focuses++; this.onFocus() }
  dispatchEvent(event: FixtureEvent) { this.events.push(event); this.onEvent(event); return !event.defaultPrevented }
  addText(text: string) { this.childNodes.push({ nodeType: 3, nodeValue: text, parentNode: this }) }
  append(element: FixtureElement) { element.parentNode = this; this.childNodes.push(element); return element }
  paragraphs(text: string) {
    this.childNodes = []
    for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
      const paragraph = this.append(new FixtureElement('P'))
      if (line) paragraph.addText(line)
      else paragraph.append(new FixtureElement('BR'))
    }
  }
}
class FixtureTextarea extends FixtureElement {
  private text = ''
  disabled = false
  readOnly = false
  setterCalls = 0
  constructor() { super('TEXTAREA'); this.isContentEditable = false }
  get value() { return this.text }
  set value(value: string) { this.setterCalls++; this.text = value }
}
function fixture(editors: FixtureElement[]) {
  const context = vm.createContext({ document: { querySelectorAll(selector: string) { assert.equal(selector, '#prompt-textarea'); return editors } },
    HTMLElement: FixtureElement, HTMLTextAreaElement: FixtureTextarea, ClipboardEvent: FixtureEvent, InputEvent: FixtureEvent,
    DataTransfer: FixtureDataTransfer,
    getComputedStyle: (node: FixtureElement) => ({ display: node.display, visibility: 'visible', opacity: node.opacity }),
  })
  return (expression: string): ChatGptComposerState => JSON.parse(JSON.stringify(vm.runInContext(expression, context)))
}
function load(minify: boolean) {
  const compiled = buildSync({ entryPoints: [path.resolve('src/main/chatgptComposer.ts')], write: false, bundle: true,
    platform: 'node', format: 'cjs', target: 'es2020', minify, logLevel: 'silent' }).outputFiles[0].text
  const module = { exports: {} as any }
  vm.runInNewContext(compiled, { module, exports: module.exports })
  return module.exports as typeof import('../src/main/chatgptComposer')
}
for (const minify of [false, true]) {
  const { chatGptComposerExpression: expression } = load(minify)
  {
    const editor = new FixtureElement(), run = fixture([editor])
    editor.onEvent = event => { assert.equal(event.type, 'paste'); assert.equal(event.bubbles, true); editor.paragraphs(event.clipboardData!.getData('text/plain')); event.preventDefault() }
    assert.deepEqual(run(expression('read', task)), { found: true, empty: true, matches: false, length: 0 })
    assert.equal(editor.focuses + editor.events.length, 0, 'reading does not focus or mutate the editor')
    const pasted = run(expression('paste', task))
    assert.equal(pasted.matches, true, 'all lines survive an editor onPaste that creates paragraph nodes')
    assert.equal(pasted.empty, false)
    assert.equal(editor.events.length, 1)
    assert.equal(editor.events[0].clipboardData!.getData('text/html'), '', 'plain text only; no HTML injection')
    assert(!JSON.stringify(pasted).includes('合成任务'), 'only booleans and length leave the page')
    run(expression('paste', task)); assert.equal(editor.events.length, 1, 'repeating paste never duplicates a nonempty draft')
    assert.deepEqual(Object.keys(pasted).sort(), ['empty', 'found', 'length', 'matches'])
  }
  for (const transform of [(text: string) => text.split('\n')[0], (text: string) => text.slice(0, -10),
    (text: string) => text.replace('最后一段', '其他内容')]) {
    const editor = new FixtureElement(), run = fixture([editor])
    editor.onEvent = event => editor.paragraphs(transform(event.clipboardData!.getData('text/plain')))
    assert.equal(run(expression('paste', task)).matches, false, 'first-line truncation, missing tail and same-length corruption must fail')
  }
  {
    const editor = new FixtureElement(), run = fixture([editor])
    editor.paragraphs('user draft must stay')
    assert.equal(run(expression('paste', task)).matches, false)
    assert.equal(editor.innerText, 'user draft must stay'); assert.equal(editor.focuses + editor.events.length, 0)
    editor.paragraphs(''); editor.onFocus = () => editor.paragraphs('restored on focus')
    assert.equal(run(expression('paste', task)).matches, false); assert.equal(editor.events.length, 0)
  }
  {
    const editor = new FixtureTextarea(), run = fixture([editor])
    // React may install an own setter. The native prototype setter must still be used.
    const native = Object.getOwnPropertyDescriptor(FixtureTextarea.prototype, 'value')!
    Object.defineProperty(editor, 'value', { get() { return native.get!.call(editor) }, set() { throw new Error('do not use the tracked own setter') } })
    const pasted = run(expression('paste', task))
    assert.equal(pasted.matches, true); assert.equal(editor.setterCalls, 1)
    assert.equal(editor.events.length, 1); assert.equal(editor.events[0].type, 'input')
    editor.readOnly = true
    assert.equal(run(expression('paste', task)).found, false)
  }
  {
    const hidden = new FixtureElement(), editor = new FixtureElement(); hidden.hidden = true
    editor.onEvent = event => editor.paragraphs(event.clipboardData!.getData('text/plain'))
    const run = fixture([hidden, editor])
    assert.equal(run(expression('paste', task)).matches, true); assert.equal(hidden.events.length, 0)
    const other = new FixtureElement(), ambiguous = fixture([editor, other])
    assert.equal(ambiguous(expression('paste', task)).found, false); assert.equal(other.events.length, 0)
    assert.equal(fixture([])(expression('read', task)).found, false)
    assert.equal(fixture([hidden])(expression('read', task)).found, false)
  }
  {
    const editor = new FixtureTextarea(), run = fixture([editor])
    editor.value = '\r\n  ' + task.replace(/\n/g, '\r\n') + '  \r\n'
    assert.equal(run(expression('read', task)).matches, true)
    editor.value = task.replace(/\n/g, '\u2028')
    assert.equal(run(expression('read', task)).matches, true)
    editor.value = task.replace('\n\n', '\n')
    assert.equal(run(expression('read', task)).matches, false, 'interior line breaks are not discarded')
  }
  {
    const editor = new FixtureElement(), run = fixture([editor])
    assert.equal(run(expression('paste', task)).matches, false, 'an unhandled synthetic paste is not success')
    editor.onEvent = () => { throw new Error('synthetic secret body must not leave the page') }
    assert(!JSON.stringify(run(expression('paste', task))).includes('secret'))
    assert.equal(editor.events.every(event => event.type === 'paste'), true, 'module never triggers a send click or keypress')
  }
}
console.log('chatgpt-composer: full multiline paste/readback, truncation, existing drafts, native textarea input, unique visible editor, redaction and minified self-contained expression passed; synthetic DOM only')
