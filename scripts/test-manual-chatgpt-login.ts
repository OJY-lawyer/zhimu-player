import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { translateRuntimeMessage } from '../src/shared/runtimeMessages'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { transformSync } = hostRequire('esbuild') as typeof import('esbuild')
const openedMessage = '已请求打开普通 Edge 登录窗口。完成登录后关闭这个专用窗口，再点击“检查连接”。'

function sourceLoader(context: vm.Context, overrides: (name: string) => unknown) {
  const cache = new Map<string, { exports: any }>()
  return function load(file: string): any {
    file = path.resolve(root, file)
    if (cache.has(file)) return cache.get(file)!.exports
    const module = { exports: {} as any }
    cache.set(file, module)
    const source = transformSync(fs.readFileSync(file, 'utf8'), {
      loader: file.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'node22', sourcefile: file,
    }).code
    const requireModule = (name: string): any => {
      const override = overrides(name)
      if (override !== undefined) return override
      if (name.endsWith('.css')) return {}
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name)
        const target = [base, base + '.ts', base + '.tsx'].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        if (!target) throw new Error('Missing fixture module: ' + name)
        return load(target)
      }
      return hostRequire(name)
    }
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(requireModule, module, module.exports)
    return module.exports
  }
}

function backend(mode: 'running' | 'handoff' | 'spawn-error' | 'throw' = 'running') {
  const directory = path.join(root, 'work', 'virtual-manual-login', 'video-player')
  const profile = path.join(directory, 'chatgpt-edge-profile')
  const executable = path.join(root, 'work', 'fixture-msedge.exe')
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const appHandlers = new Map<string, (...args: any[]) => unknown>()
  const files = new Map([
    [path.join(profile, 'Default', 'Network', 'Cookies'), 'unchanged synthetic account'],
    [path.join(profile, 'Default', 'Preferences'), 'unchanged synthetic preferences'],
  ])
  const before = [...files]
  const calls: { file: string; args: string[]; options: any; child: FakeChild }[] = []
  const mkdirs: string[] = []
  class FakeChild extends EventEmitter {
    exitCode: number | null = null
    killCalls = 0
    unrefCalls = 0
    kill() { this.killCalls++; return true }
    unref() { this.unrefCalls++ }
  }
  const forbidden = () => { throw new Error('Manual login must not read, delete, copy or change account files') }
  const disk = { existsSync: (file: string) => file === executable, promises: {
    mkdir: async (file: string) => { mkdirs.push(file) },
    readFile: forbidden, writeFile: forbidden, rm: forbidden, copyFile: forbidden, cp: forbidden, readdir: forbidden,
  } }
  const electron = {
    app: { getPath: () => directory, on: (name: string, callback: (...args: any[]) => unknown) => appHandlers.set(name, callback), quit: forbidden },
    ipcMain: { handle: (name: string, callback: (...args: any[]) => Promise<any>) => handlers.set(name, callback) },
    clipboard: { readText: forbidden, clear: forbidden },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 900 } }) },
  }
  const context = vm.createContext({ console, URL, Buffer, Date, process: { env: { VIDEO_PLAYER_EDGE_PATH: executable } },
    setTimeout: () => { throw new Error('Manual login must return without a polling deadline') }, clearTimeout: () => {},
    fetch: forbidden, WebSocket: class { constructor() { throw new Error('Manual login must not connect CDP') } },
  })
  const load = sourceLoader(context, name => {
    if (name === 'electron') return electron
    if (name === 'node:fs') return disk
    if (name === 'node:child_process') return { spawn(file: string, args: string[], options: any) {
      if (mode === 'throw') throw new Error('fixture private path must not leak')
      const child = new FakeChild()
      calls.push({ file, args, options, child })
      queueMicrotask(() => {
        if (mode === 'spawn-error') child.emit('error', new Error('fixture ENOENT private path must not leak'))
        else {
          child.emit('spawn')
          if (mode === 'handoff') { child.exitCode = 0; child.emit('exit', 0) }
        }
      })
      return child
    } }
  })
  const worker = load('src/main/chatgptEdgeWorker.ts')
  worker.registerChatGptEdgeWorker(() => null)
  return { handlers, appHandlers, calls, mkdirs, files, before, profile, executable, worker }
}

function setupFixture(language: 'en' | 'zh-CN') {
  const hooks: any[] = []
  let cursor = 0
  let resolveLogin: (value: any) => void = () => { throw new Error('Login not requested') }
  let probeCalls = 0
  const react = {
    useState(initial: any) {
      const slot = cursor++
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
      return [hooks[slot], (value: any) => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value }]
    },
    useRef(initial: any) { return react.useState({ current: initial })[0] },
    useEffect() {},
  }
  const context = vm.createContext({ console, URL, window: { electronAPI: {
    loginChatGpt: () => new Promise(resolve => { resolveLogin = resolve }),
    probeChatGpt: async () => { probeCalls++; return { success: true, authenticated: true, projectVisible: false,
      message: 'ChatGPT 登录成功。模型与思考档位会在生成前核验。' } },
  } } })
  const load = sourceLoader(context, name => {
    if (name === 'react') return react
    if (name === '../i18n') return { useI18n: () => ({ language, setLanguage() {},
      t: (zh: string, en: string) => language === 'en' ? en : zh,
      translateMessage: (message: string) => translateRuntimeMessage(message, language),
    }) }
    if (name === './Icons') return { Icon: () => null }
  })
  const { SetupDialog } = load('src/renderer/components/SetupDialog.tsx')
  const render = () => { cursor = 0; return SetupDialog({ config: { provider: 'chatgpt-web', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: '', chatGptTier: 'pro' }, onSave: async () => {}, onClose() {}, onAbout() {}, onRestartSetup() {} }) }
  return { render, completeLogin: (result: any) => resolveLogin(result), get probeCalls() { return probeCalls } }
}

function nodes(tree: any): any[] {
  if (tree == null || typeof tree === 'boolean') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (typeof tree !== 'object') return [tree]
  return [tree, ...nodes(tree.props?.children)]
}
function text(tree: any): string { return nodes(tree).filter(node => typeof node === 'string' || typeof node === 'number').join('') }
function button(tree: any, label: string): any {
  const result = nodes(tree).find(node => node?.type === 'button' && text(node) === label)
  assert.ok(result, 'Expected button: ' + label)
  return result
}
const settle = () => new Promise(resolve => setImmediate(resolve))

async function main() {
  for (const mode of ['running', 'handoff'] as const) {
    const host = backend(mode)
    const result = await host.handlers.get('chatgpt-login')!()
    assert.equal(result.success, true)
    assert.equal(result.authenticated, false, 'opening an ordinary browser is never a sign-in verdict')
    assert.equal(result.projectVisible, false)
    assert.equal(result.message, openedMessage)
    assert.equal(host.calls.length, 1)
    const call = host.calls[0]
    assert.equal(call.file, host.executable)
    assert(call.args.includes('--user-data-dir=' + host.profile))
    assert.equal(call.args.at(-1), 'https://chatgpt.com/')
    assert(call.args.includes('--new-window'))
    assert(!call.args.some(arg => /remote-debugging|enable-automation|headless|disable-web-security|ignore-certificate/i.test(arg)))
    assert.equal(call.options.detached, true)
    assert.equal(call.options.windowsHide, false)
    assert.equal(call.options.stdio, 'ignore')
    assert.equal(call.child.unrefCalls, 1)
    await host.worker.shutdownChatGptBrowser()
    host.appHandlers.get('before-quit')!({ preventDefault() { throw new Error('Player quit must not wait for manual login') } })
    assert.equal(call.child.killCalls, 0, 'the user keeps control of their ordinary sign-in window')
    const next = await host.handlers.get('chatgpt-generate-guide')!({}, { taskMarkdown: '' })
    assert.equal(next.message, '导读任务内容为空。', 'manual sign-in has released the worker, rather than polling for authentication')
    assert.deepEqual(host.mkdirs, [host.profile])
    assert.deepEqual([...host.files], host.before)
  }
  for (const mode of ['spawn-error', 'throw'] as const) {
    const host = backend(mode)
    const result = await host.handlers.get('chatgpt-login')!()
    assert.equal(result.success, false)
    assert.equal(result.authenticated, false)
    assert.equal(result.message, '无法启动专用 Edge，请检查安装路径。')
    assert(!result.message.includes('private'))
    assert.deepEqual([...host.files], host.before)
  }
  for (const language of ['en', 'zh-CN'] as const) {
    const fixture = setupFixture(language)
    const en = language === 'en'
    let tree = fixture.render()
    const open = en ? 'Open sign-in' : '打开登录窗口'
    const check = en ? 'Check connection' : '检查连接'
    assert(text(tree).includes(en ? 'Close it when finished' : '完成后关闭该窗口'))
    button(tree, open).props.onClick()
    tree = fixture.render()
    assert(text(tree).includes(en ? 'Opening a regular Edge' : '正在打开普通 Edge'))
    assert.equal(button(tree, check).props.disabled, true)
    fixture.completeLogin({ success: true, authenticated: false, projectVisible: false, message: openedMessage })
    await settle()
    tree = fixture.render()
    assert(text(tree).includes(en ? 'Complete sign-in in Edge' : '等待你完成登录'))
    assert(text(tree).includes(en ? 'close that dedicated window' : '关闭这个专用窗口'))
    assert.equal(button(tree, check).props.disabled, false, 'opening the browser must not block settings for the duration of sign-in')
    assert(!text(tree).includes(en ? 'Signed in to ChatGPT' : '已登录 ChatGPT'))
    assert.equal(fixture.probeCalls, 0, 'no automatic probing occurs while the user signs in')
    button(tree, check).props.onClick()
    await settle()
    tree = fixture.render()
    assert.equal(fixture.probeCalls, 1)
    assert(text(tree).includes(en ? 'Signed in to ChatGPT' : '已登录 ChatGPT'))
  }
  console.log('manual-chatgpt-login: ordinary browser arguments, handoff, error handling, preserved profile, user-owned lifetime and bilingual UI transitions passed; offline fixtures only')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
