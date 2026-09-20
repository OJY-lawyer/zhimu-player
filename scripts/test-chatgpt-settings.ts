import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { transformSync } = hostRequire('esbuild') as typeof import('esbuild')
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

function sourceLoader(context: vm.Context, override: (name: string) => unknown) {
  const cache = new Map<string, { exports: any }>()
  return function load(relative: string): any {
    const file = path.resolve(root, relative)
    if (cache.has(file)) return cache.get(file)!.exports
    const module = { exports: {} as any }
    cache.set(file, module)
    const source = transformSync(fs.readFileSync(file, 'utf8'), {
      loader: file.endsWith('tsx') ? 'tsx' : 'ts', jsx: 'automatic', format: 'cjs', target: 'node22', sourcefile: file,
    }).code
    const localRequire = (name: string): any => {
      const mock = override(name)
      if (mock !== undefined) return mock
      if (name.endsWith('.css')) return {}
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(file), name)
        const target = [base, base + '.ts', base + '.tsx'].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        if (!target) throw new Error('Missing fixture module: ' + name)
        return load(target)
      }
      return hostRequire(name)
    }
    vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(localRequire, module, module.exports)
    return module.exports
  }
}

function reactFixture() {
  const hooks: any[] = []
  let cursor = 0
  const react = {
    useState(initial: any): any[] {
      const slot = cursor++
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
      return [hooks[slot], (value: any) => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value }]
    },
    useRef(initial: any) { return react.useState({ current: initial })[0] },
    useCallback(callback: any) { return callback },
    useEffect() {},
  }
  return { react, reset() { cursor = 0 }, remount() { hooks.length = 0; cursor = 0 } }
}

function nodes(tree: any): any[] {
  if (tree == null || typeof tree === 'boolean') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (typeof tree !== 'object') return [tree]
  return [tree, ...nodes(tree.props?.children)]
}
const text = (tree: any) => nodes(tree).filter(node => typeof node === 'string' || typeof node === 'number').join('')
const control = (tree: any, id: string) => {
  const node = nodes(tree).find(item => item?.props?.id === id)
  assert.ok(node, 'Expected control: ' + id)
  return node
}
const button = (tree: any, label: string) => {
  const node = nodes(tree).find(item => item?.type === 'button' && text(item) === label)
  assert.ok(node, 'Expected button: ' + label)
  return node
}
const settle = () => new Promise(resolve => setImmediate(resolve))
const selection = { model: 'GPT-5.6 Sol', reasoning: 'Medium' }
const initialConfig = { provider: 'chatgpt-web', baseUrl: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: '', chatGptTier: 'pro' }

function setupFixture(language: 'en' | 'zh-CN', config: Record<string, unknown> = initialConfig) {
  const hooks = reactFixture()
  const saved: any[] = []
  const imported: { source: string; raw?: string }[] = []
  let probeResult: any = { success: true, authenticated: true, authStatus: 'authenticated', projectVisible: false, message: 'Fixture authenticated' }
  let probeFailure = ''
  let modelResult: any = { success: true, models: [{ model: 'Fixture webpage model', reasoningOptions: ['Fast', 'Thorough'] }], message: 'Fixture options' }
  const context = vm.createContext({ console, URL, window: { electronAPI: {
    probeChatGpt: async () => { if (probeFailure) throw vm.runInContext('new Error(' + JSON.stringify(probeFailure) + ')', context); return probeResult },
    listChatGptModels: async () => modelResult,
    importChatGptCookies: async (source: string, raw?: string) => { imported.push({ source, raw }); return { success: true, authenticated: false, authStatus: 'unknown', projectVisible: false, message: 'Fixture import complete; check connection' } },
    logoutChatGpt: async () => ({ success: true, authenticated: false, authStatus: 'signed-out', projectVisible: false, message: 'Fixture signed out' }),
  } } })
  const load = sourceLoader(context, name => {
    if (name === 'react') return hooks.react
    if (name === '../i18n') return { useI18n: () => ({ language, setLanguage() {}, t: (zh: string, en: string) => language === 'en' ? en : zh, translateMessage: (value: string) => value }) }
    if (name === './Icons') return { Icon: () => null }
  })
  const { SetupDialog } = load('src/renderer/components/SetupDialog.tsx')
  return {
    render() { hooks.reset(); return SetupDialog({ config, onSave: async (value: any) => { saved.push(plain(value)) }, onClose() {}, onAbout() {}, onRestartSetup() {} }) },
    remount() { hooks.remount() }, saved, imported,
    setProbe(value: any) { probeResult = value }, setModels(value: any) { modelResult = value },
    setProbeFailure(value: string) { probeFailure = value },
  }
}

async function testSettings() {
  for (const language of ['en', 'zh-CN'] as const) {
    const fixture = setupFixture(language)
    const en = language === 'en'
    const save = en ? 'Save settings' : '保存设置'
    const refresh = en ? 'Refresh options from ChatGPT' : '从 ChatGPT 刷新可用选项'
    const check = en ? 'Check connection' : '检查连接'
    let tree = fixture.render()
    assert(!nodes(tree).some(item => item?.props?.id === 'chat-tier'), 'subscription no longer determines the target')
    assert(!text(tree).includes(en ? 'Previous setting' : '旧设置'), 'migration internals do not appear in the normal user flow')
    assert(text(tree).includes(en ? 'account access is not yet verified' : '尚未核实账号权限'))
    for (const label of [en ? 'Open sign-in' : '打开登录窗口', en ? 'Import cookies' : '导入 Cookie', check]) {
      assert.match(button(tree, label).props.className, /button-(primary|secondary)/, 'connection actions are visible full buttons')
    }
    assert(nodes(tree).findIndex(item => item === button(tree, check)) < nodes(tree).findIndex(item => item === control(tree, 'chat-model')), 'connection actions come before model options')
    assert(!nodes(tree).some(item => item?.props?.id === 'chat-cookie-import'))
    assert.equal(control(tree, 'chat-model').props.value, '')
    button(tree, save).props.onClick(); await settle()
    assert.equal(fixture.saved.length, 0)
    control(fixture.render(), 'chat-model').props.onChange({ target: { value: 'GPT-5.6 Sol' } })
    tree = fixture.render()
    assert.equal(control(tree, 'chat-reasoning').props.value, '', 'choosing a model must not silently assign reasoning')
    button(tree, save).props.onClick(); await settle()
    assert.equal(fixture.saved.length, 0)
    control(fixture.render(), 'chat-reasoning').props.onChange({ target: { value: 'Medium' } })
    button(fixture.render(), save).props.onClick(); await settle()
    assert.deepEqual(fixture.saved.at(-1).chatGptSelection, selection)
    for (const model of ['GPT-5.6 Sol', 'GPT-6 Astra']) {
      control(fixture.render(), 'chat-model').props.onChange({ target: { value: model } })
      tree = fixture.render()
      assert.equal(control(tree, 'chat-reasoning').props.disabled, false, 'both model families retain an independent reasoning selector')
      assert(text(control(tree, 'chat-reasoning')).includes('Pro'), 'Pro is a reasoning choice for either model family')
      control(tree, 'chat-reasoning').props.onChange({ target: { value: 'Pro' } })
      button(fixture.render(), save).props.onClick(); await settle()
      assert.deepEqual(fixture.saved.at(-1).chatGptSelection, { model, reasoning: 'Pro' })
    }
    control(fixture.render(), 'chat-model').props.onChange({ target: { value: selection.model } })
    control(fixture.render(), 'chat-reasoning').props.onChange({ target: { value: selection.reasoning } })

    button(fixture.render(), refresh).props.onClick(); await settle()
    tree = fixture.render()
    assert.equal(control(tree, 'chat-model').props.value, selection.model, 'refresh must retain an unavailable saved selection')
    assert(text(tree).includes(en ? 'not in the current website options' : '不在本次网页选项中'))
    const savedBefore = fixture.saved.length
    button(tree, save).props.onClick(); await settle()
    assert.equal(fixture.saved.length, savedBefore, 'a contradicted live choice requires correction')
    control(fixture.render(), 'chat-model').props.onChange({ target: { value: 'Fixture webpage model' } })
    tree = fixture.render()
    assert.equal(control(tree, 'chat-reasoning').props.value, '')
    assert(text(control(tree, 'chat-reasoning')).includes('Fast'))
    assert(!text(control(tree, 'chat-reasoning')).includes('Medium'), 'reasoning options belong to the selected model')
    control(tree, 'chat-reasoning').props.onChange({ target: { value: 'Fast' } })
    button(fixture.render(), save).props.onClick(); await settle()
    assert.deepEqual(fixture.saved.at(-1).chatGptSelection, { model: 'Fixture webpage model', reasoning: 'Fast' })
    fixture.setModels({ success: false, models: [], message: 'Fixture network unavailable' })
    button(fixture.render(), refresh).props.onClick(); await settle()
    assert.equal(control(fixture.render(), 'chat-model').props.value, 'Fixture webpage model')
    assert(text(control(fixture.render(), 'chat-reasoning')).includes('Fast'), 'failed refresh keeps previous menu evidence')

    button(fixture.render(), check).props.onClick(); await settle()
    assert(text(fixture.render()).includes(en ? 'Signed in to ChatGPT' : '已登录 ChatGPT'))
    fixture.setProbe({ success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message: 'Fixture timeout' })
    button(fixture.render(), check).props.onClick(); await settle()
    tree = fixture.render()
    assert(text(tree).includes(en ? 'Previously confirmed signed in' : '上次已确认登录'))
    assert(text(tree).includes(en ? 'does not mean you were signed out' : '不表示账号已退出'))
    fixture.remount()
    assert(text(fixture.render()).includes(en ? 'Previously confirmed signed in' : '上次已确认登录'), 'reopening settings retains session-only confirmation')
    button(fixture.render(), en ? 'Import cookies' : '导入 Cookie').props.onClick()
    tree = fixture.render()
    assert.equal(button(tree, en ? 'Import cookies' : '导入 Cookie').props['aria-expanded'], true)
    assert(nodes(tree).some(item => item?.props?.id === 'chat-cookie-import' && item.type !== 'details'), 'import choices are ordinary controls, not a tiny disclosure summary')
    for (const [label, source] of [[en ? 'Import JSON file' : '从 JSON 文件导入', 'file'], [en ? 'Import clipboard' : '从剪贴板导入', 'clipboard']]) {
      button(fixture.render(), label).props.onClick(); await settle()
      assert.equal(fixture.imported.at(-1)?.source, source)
      assert(text(fixture.render()).includes('Fixture import complete'))
      assert(!nodes(fixture.render()).some(item => item?.type === 'textarea'), 'cookie material has no renderer input or output')
    }
    const paste = en ? 'Paste JSON' : '粘贴 JSON'
    const importPasted = en ? 'Import pasted JSON' : '导入粘贴内容'
    const syntheticCookie = '[{"name":"fixture","value":"synthetic-only","domain":"chatgpt.com"}]'
    button(fixture.render(), paste).props.onClick()
    tree = fixture.render()
    assert.equal(control(tree, 'chat-cookie-json').props.spellCheck, false)
    assert.equal(control(tree, 'chat-cookie-json').props.autoComplete, 'off')
    assert.equal(button(tree, importPasted).props.disabled, true)
    control(tree, 'chat-cookie-json').props.onChange({ target: { value: syntheticCookie } })
    button(fixture.render(), importPasted).props.onClick()
    assert(!nodes(fixture.render()).some(item => item?.props?.id === 'chat-cookie-json'), 'pasted secret is cleared and hidden before awaiting import')
    await settle()
    assert.deepEqual(fixture.imported.at(-1), { source: 'paste', raw: syntheticCookie })
    button(fixture.render(), paste).props.onClick()
    assert.equal(control(fixture.render(), 'chat-cookie-json').props.value, '')
    control(fixture.render(), 'chat-cookie-json').props.onChange({ target: { value: syntheticCookie } })
    button(fixture.render(), en ? 'Import cookies' : '导入 Cookie').props.onClick()
    button(fixture.render(), en ? 'Import cookies' : '导入 Cookie').props.onClick()
    button(fixture.render(), paste).props.onClick()
    assert.equal(control(fixture.render(), 'chat-cookie-json').props.value, '', 'closing import removes the draft paste')
    assert(!JSON.stringify(fixture.saved).includes('synthetic-only'), 'cookie text is never part of saved settings')
    fixture.setProbe({ success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message: 'Fixture specific failure: imported cookie attributes did not verify; previous state restored.' })
    button(fixture.render(), check).props.onClick(); await settle()
    const status = nodes(fixture.render()).find(item => item?.props?.className === 'setup-chat-status')
    assert(text(status).includes('cookie attributes did not verify'), 'specific safe backend details appear in the main connection status')
    fixture.setProbeFailure('Fixture explicit import verification error')
    button(fixture.render(), check).props.onClick(); await settle()
    const thrownStatus = nodes(fixture.render()).find(item => item?.props?.className === 'setup-chat-status')
    assert(text(thrownStatus).includes('Fixture explicit import verification error'), 'a thrown IPC error also stays visible in the connection status')
    button(fixture.render(), en ? 'Sign out of this session' : '退出专用账号').props.onClick(); await settle()
    assert(text(fixture.render()).includes(en ? 'Signed out of ChatGPT' : '尚未登录 ChatGPT'))
    const existing = setupFixture(language, { ...initialConfig, chatGptSelection: selection })
    assert.equal(control(existing.render(), 'chat-model').props.value, selection.model)
    assert.equal(control(existing.render(), 'chat-reasoning').props.value, selection.reasoning, 'opening settings preserves a valid selection')
  }
}

function testConfigMigration() {
  const directory = path.join(root, 'work', 'virtual-chatgpt-settings')
  const configPath = path.join(directory, 'config.json')
  const files = new Map<string, string>()
  const context = vm.createContext({ Buffer, URL })
  const load = sourceLoader(context, name => {
    if (name === 'electron') return { app: { getPath: () => directory }, safeStorage: { isEncryptionAvailable: () => true, encryptString: () => { throw new Error('No secret should be read') }, decryptString: () => { throw new Error('No secret should be read') } } }
    if (name === 'node:fs') return {
      readFileSync(file: string) { if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(file) },
      writeFileSync(file: string, content: string) { files.set(file, content) },
      renameSync(from: string, to: string) { files.set(to, files.get(from)!); files.delete(from) },
    }
  })
  const config = load('src/main/configStore.ts')
  for (const legacy of [{}, { chatGptTier: 'plus' }, { chatGptTier: 'pro' }]) {
    files.set(configPath, JSON.stringify(legacy))
    const before = files.get(configPath)
    const loaded = config.loadConfig()
    assert.equal(loaded.chatGptTier, (legacy as any).chatGptTier)
    assert.deepEqual(plain(loaded.chatGptSelection), (legacy as any).chatGptTier === 'pro' ? { model: 'GPT-6 Astra', reasoning: 'Pro' } : null, 'only the established old Astra Pro selection keeps its meaning; missing preferences never default to Pro')
    assert.equal(files.get(configPath), before, 'reading old settings does not rewrite user preferences')
  }
  files.set(configPath, JSON.stringify({ chatGptTier: 'pro', chatGptSelection: null }))
  assert.equal(config.loadConfig().chatGptSelection, null, 'an explicitly cleared choice stays cleared')
  files.set(configPath, JSON.stringify({ ...initialConfig, chatGptSelection: selection, chatGptProject: 'Original project' }))
  const loaded = config.loadConfig()
  config.saveConfig({ ...loaded, provider: 'compatible-api' })
  assert.deepEqual(plain(config.loadConfig().chatGptSelection), selection)
  config.saveGuideLanguage('en')
  assert.deepEqual(plain(config.loadConfig().chatGptSelection), selection, 'changing guide language preserves the website selection')
  assert.equal(config.loadConfig().chatGptProject, 'Original project')
  assert.throws(() => config.saveConfig({ ...loaded, chatGptSelection: { model: 'Sol', reasoning: '' } }), /Invalid ChatGPT/)
}

async function testGuideRequest() {
  const hooks = reactFixture()
  const requests: any[] = []
  const versions: string[] = []
  let saved: any = null
  const context = vm.createContext({ console, URL, window: { electronAPI: {
    saveConfig: async (value: any) => { saved = value }, loadConfig: async () => saved,
    generateChatGptGuide: async (request: any) => { requests.push(plain(request)); return { success: true, content: '### Topic [P1-00:00:01]\nText', message: 'complete' } },
  } } })
  const load = sourceLoader(context, name => {
    if (name === 'react') return hooks.react
    if (name === '../i18n') return { getAppLanguage: () => 'en' }
  })
  const { useGuideGeneration } = load('src/renderer/hooks/useGuideGeneration.ts')
  const playlist = { displayName: 'Fixture', items: [{ stem: 'P1', subtitleOffset: 0, subtitles: [{ startTime: 1, text: 'Fixture text' }] }] }
  const render = () => { hooks.reset(); return useGuideGeneration(playlist, async (_content: string, label: string) => { versions.push(label); return 'fixture.md' }) }
  await render().generate()
  assert.equal(requests.length, 0, 'missing selection opens settings without sending subtitles')
  assert.equal(render().showConfig, true)
  await render().saveConfig({ ...initialConfig, chatGptSelection: selection, guideLanguage: 'en' })
  await render().generate()
  assert.deepEqual(requests[0].selection, selection)
  assert.equal(requests[0].tier, undefined, 'legacy plan is not sent to the website worker')
  assert.equal(versions[0], 'Guide.ChatGPT-GPT-5.6-Sol-Medium.en')
  assert.equal(render().providerLabel, 'ChatGPT · GPT-5.6 Sol · Medium')
}

async function main() {
  testConfigMigration()
  await testSettings()
  await testGuideRequest()
  console.log('chatgpt-settings: independent model/level choice, migration, live menu association, cookie import actions, uncertain auth retention and generated labels passed; offline fixtures only')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
