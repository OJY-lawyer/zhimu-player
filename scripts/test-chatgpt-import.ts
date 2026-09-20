import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { transformSync } = hostRequire('esbuild') as typeof import('esbuild')
const secret = 'fixture-private'
const exportText = JSON.stringify([{ domain: '.chatgpt.com', name: '__Secure-next-auth.session-token', value: secret, secure: true, httpOnly: true, session: true }])

function fixture() {
  const handlers = new Map<string, (...args: any[]) => Promise<any>>()
  const profile = path.join(root, 'work', 'virtual-cookie-import', 'video-player')
  const executable = path.join(root, 'work', 'fixture-edge.exe')
  const file = path.join(root, 'work', 'fixture-cookies.json')
  const calls: string[] = []
  const state = { text: exportText, fileText: exportText, fileSize: exportText.length, cancelled: false,
    auth: 'authenticated', imported: 0, failedImport: false, changedClipboard: false, launches: 0 }
  const cdp = {
    isClosed: false,
    async send(method: string, params: any) {
      calls.push(method)
      if (method === 'Target.createTarget') return { targetId: 'fixture-target' }
      if (method === 'Target.attachToTarget') return { sessionId: 'fixture-session' }
      if (method === 'Runtime.evaluate') {
        const expression = params.expression as string
        if (expression === '({readyState: document.readyState})') return { result: { value: { readyState: 'complete' } } }
        if (expression === 'document.readyState') return { result: { value: 'complete' } }
        if (expression.includes('/api/auth/session')) return { result: { value: {
          success: state.auth === 'authenticated', authenticated: state.auth === 'authenticated', authStatus: state.auth,
          projectVisible: false, message: state.auth === 'authenticated' ? 'ChatGPT 登录成功。模型与思考档位会在生成前核验。' : 'ChatGPT 尚未登录，请在浏览器中完成登录。',
        } } }
        throw new Error('Unexpected page evaluation in fixture')
      }
      return {}
    },
    async close() { calls.push('close') },
  }
  const electron = {
    app: { getPath: () => profile, on() {} },
    ipcMain: { handle: (name: string, fn: any) => handlers.set(name, fn) },
    dialog: { async showOpenDialog() { calls.push('dialog'); return { canceled: state.cancelled, filePaths: state.cancelled ? [] : [file] } } },
    clipboard: { async readText() { return state.text }, async clear() { calls.push('clear-clipboard'); state.text = '' } },
  }
  const disk = { existsSync: (name: string) => name === executable, promises: {
    async mkdir() {}, async rm(name: string) { assert(name.endsWith('DevToolsActivePort'), 'only connection metadata may be removed') },
    async stat(name: string) { assert.equal(name, file); return { isFile: () => true, size: state.fileSize } },
    async readFile(name: string) {
      if (name.endsWith('DevToolsActivePort')) return '12345\n/devtools/browser/00000000-0000-0000-0000-000000000000'
      assert.equal(name, file); calls.push('read-export'); return state.fileText
    },
  } }
  const context = vm.createContext({ console, URL, Buffer, Date, setTimeout, clearTimeout, process: { env: { VIDEO_PLAYER_EDGE_PATH: executable } } })
  const cache = new Map<string, any>()
  function load(filename: string): any {
    filename = path.resolve(root, filename)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} as any }; cache.set(filename, module)
    const code = transformSync(fs.readFileSync(filename, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node22' }).code
    const requireModule = (name: string): any => {
      if (name === 'electron') return electron
      if (name === 'node:fs') return disk
      if (name === 'node:child_process') return { spawn() { state.launches++; return Object.assign(new EventEmitter(), { exitCode: 0, kill() {} }) } }
      if (name === './edgeCdp') return { connectEdge: async () => cdp, parseEdgeEndpoint: () => 'ws://127.0.0.1:12345/devtools/browser/00000000-0000-0000-0000-000000000000' }
      if (name === './chatgptCookieSession') return { ChatGptCookieImportError: class extends Error {}, async applyChatGptCookies(_port: any, cookies: any[]) {
        if (state.failedImport) throw new Error(secret)
        assert.equal(cookies.length, 1); assert.equal(cookies[0].value, secret)
        state.imported++; if (state.changedClipboard) state.text = 'new unrelated clipboard text'
      } }
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name) + '.ts')
      return hostRequire(name)
    }
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context)(requireModule, module, module.exports)
    return module.exports
  }
  load('src/main/chatgptEdgeWorker.ts').registerChatGptEdgeWorker(() => null)
  const invoke = (name: string, ...args: any[]) => handlers.get(name)!({}, ...args)
  return { state, calls, invoke }
}

async function main() {
  for (const source of ['file', 'clipboard', 'paste']) {
    const f = fixture()
    const result = await f.invoke('chatgpt-import-cookies', source, source === 'paste' ? exportText : undefined)
    assert.equal(result.authStatus, 'authenticated'); assert.equal(f.state.imported, 1)
    assert(!JSON.stringify(result).includes(secret), 'renderer never receives cookie values')
    assert.equal(f.calls.includes('dialog'), source === 'file')
    assert.equal(f.state.text === '', source === 'clipboard', 'only imported clipboard text is cleared')
    assert(!f.calls.includes('Storage.clearCookies'))
  }
  const changed = fixture(); changed.state.changedClipboard = true
  await changed.invoke('chatgpt-import-cookies', 'clipboard')
  assert.equal(changed.state.text, 'new unrelated clipboard text')
  const cancel = fixture(); cancel.state.cancelled = true
  assert.equal((await cancel.invoke('chatgpt-import-cookies', 'file')).authStatus, 'unknown')
  assert.equal(cancel.state.launches, 0); assert.equal(cancel.state.imported, 0)
  const oversized = fixture(); oversized.state.fileSize = 3 * 1024 * 1024
  assert.equal((await oversized.invoke('chatgpt-import-cookies', 'file')).success, false)
  assert(!oversized.calls.includes('read-export')); assert.equal(oversized.state.launches, 0)
  const invalid = fixture(); invalid.state.text = 'malformed ' + secret
  const bad = await invalid.invoke('chatgpt-import-cookies', 'clipboard')
  assert(!bad.message.includes(secret)); assert.equal(invalid.state.launches, 0)
  assert.equal(invalid.state.text, 'malformed ' + secret, 'invalid input leaves clipboard intact')
  const pasted = fixture()
  const badPaste = await pasted.invoke('chatgpt-import-cookies', 'paste', { value: secret })
  assert.equal(badPaste.authStatus, 'unknown'); assert.equal(pasted.state.launches, 0)
  assert(!badPaste.message.includes(secret))
  const largePaste = await pasted.invoke('chatgpt-import-cookies', 'paste', 'x'.repeat(2 * 1024 * 1024 + 1))
  assert.equal(largePaste.success, false); assert.equal(pasted.state.launches, 0)
  const failed = fixture(); failed.state.failedImport = true
  const failure = await failed.invoke('chatgpt-import-cookies', 'clipboard')
  assert.equal(failure.authStatus, 'unknown'); assert(!failure.message.includes(secret))
  assert(failed.calls.includes('close')); assert.equal(failed.state.text, exportText)
  const expired = fixture(); expired.state.auth = 'signed-out'
  const loggedOut = await expired.invoke('chatgpt-import-cookies', 'file')
  assert.equal(loggedOut.success, false); assert.equal(loggedOut.authStatus, 'signed-out')
  assert.equal(expired.state.imported, 1, 'import completion does not claim service authentication')
  const noModel = fixture()
  const denied = await noModel.invoke('chatgpt-generate-guide', { taskMarkdown: 'test captions', tier: 'pro' })
  assert.equal(denied.success, false); assert.equal(noModel.state.launches, 0, 'legacy tier must not send a task')
  console.log('chatgpt-import: file/clipboard IPC, private session, cancellation, limits, safe failures and explicit model choice passed; offline fixtures only')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
