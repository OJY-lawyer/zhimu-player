import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const checks = []
const add = (name, status, detail) => checks.push({ name, status, detail })
const [major, minor] = process.versions.node.split('.').map(Number)
add('node', major > 22 || major === 22 && minor >= 12 ? 'ok' : 'error', process.versions.node)
add('platform', process.platform === 'win32' && process.arch === 'x64' ? 'ok' : 'warning', `${process.platform}/${process.arch}; Windows x64 is the supported desktop target`)
for (const name of ['electron', 'electron-builder', 'vite', 'typescript', 'esbuild']) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
    add(name, 'ok', manifest.version)
  } catch { add(name, 'error', 'Dependency missing; run npm ci in the project directory') }
}
const electronFile = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'
add('electron-binary', fs.existsSync(path.join(root, 'node_modules/electron/dist', electronFile)) ? 'ok' : 'error', 'Project-local binary; a dependency manifest alone is insufficient')
const edgePaths = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
  .filter(Boolean).map(base => path.join(base, 'Microsoft/Edge/Application/msedge.exe'))
add('chatgpt-browser', edgePaths.some(candidate => fs.existsSync(candidate)) ? 'ok' : 'warning', 'Microsoft Edge is required for the ChatGPT web route; DeepSeek API does not need Edge')
for (const relative of ['package-lock.json', 'src/main/index.ts', 'src/preload/index.ts', 'src/renderer/index.html', 'LICENSE', 'NOTICE']) {
  add(relative, fs.existsSync(path.join(root, relative)) ? 'ok' : 'error', 'Required project file')
}
add('accounts', 'manual', 'Complete ChatGPT and optional Tingwu sign-in in the app; no account or personal configuration was read')
add('verification', 'manual', 'Run typecheck, tests and build; verify real login, media playback and cloud jobs separately')
const result = { ok: !checks.some(check => check.status === 'error'), checks }
console.log(JSON.stringify(result, null, 2))
process.exitCode = result.ok ? 0 : 1
