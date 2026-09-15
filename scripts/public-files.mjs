import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const rootFiles = ['.gitignore', 'AGENTS.md', 'README.md', 'README.en.md', '使用说明.md', 'DESIGN.md', 'LICENSE', 'NOTICE',
  'package.json', 'package-lock.json', 'electron-builder.json', 'tsconfig.json', 'vite.config.ts']
const scripts = ['prepare-guide-input.mjs', 'doctor.mjs', 'run-tests.mjs', 'public-files.mjs',
  'export-public.mjs', 'third-party-notices.mjs', 'smoke-release.cjs', 'smoke-window-activation.cjs', 'smoke-player-layout.cjs', 'check-release.mjs']
// The author explicitly authorized these three About-page images for public distribution.
const assets = ['assets/app-icon.png', 'assets/app-icon.ico', 'assets/about/author-wechat-original.png',
  'assets/about/donation-original.png', 'assets/about/support-frame.png']
const textExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html', '.css', '.md', '.txt', '.yml', '.yaml', '.svg'])

export async function collectPublicFiles(root) {
  const files = []
  async function add(relative) {
    const info = await lstat(path.join(root, relative))
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Not a regular public file: ${relative}`)
    if (info.size > 5 * 1024 * 1024) throw new Error(`Public file exceeds 5 MiB: ${relative}`)
    files.push(relative.replaceAll('\\', '/'))
  }
  async function walk(relative, extensions) {
    const info = await lstat(path.join(root, relative))
    if (info.isSymbolicLink()) throw new Error(`Symbolic link in public tree: ${relative}`)
    for (const item of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, item.name)
      if (item.isSymbolicLink()) throw new Error(`Symbolic link in public tree: ${child}`)
      if (item.isDirectory()) {
        if (/^(node_modules|work|outputs|state|data|\.git|.*profile)$/i.test(item.name)) throw new Error(`Private directory inside public tree: ${child}`)
        await walk(child, extensions)
      } else if (extensions.has(path.extname(item.name).toLowerCase())) await add(child)
      else throw new Error(`Unexpected file in public tree: ${child}`)
    }
  }
  for (const relative of rootFiles) await add(relative)
  // Ship the reference translation explicitly; LICENSE remains the governing text.
  await add('docs/LICENSE.en.md')
  for (const relative of scripts) await add(`scripts/${relative}`)
  for (const item of await readdir(path.join(root, 'scripts'))) if (/^test-[a-z0-9-]+\.ts$/i.test(item)) await add(`scripts/${item}`)
  await walk('src', textExtensions)
  await walk('docs', new Set(['.md', '.txt', '.json']))
  await walk('.github/workflows', new Set(['.yml', '.yaml']))
  for (const relative of assets) await add(relative)
  return [...new Set(files)].sort()
}

export async function scanPublicFiles(root, files) {
  const findings = []
  const rules = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ['api-key-literal', /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
    ['jwt-literal', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g],
    ['secret-assignment', /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_./+=-]{24,}["']/gi],
    ['developer-profile-path', /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"']+[\\/]+/gi],
    ['private-runtime-path', /[A-Za-z]:[\\/]+(?:Harness-Shared-Config|Local-Runtimes|WorkBuddy)[\\/]+/gi],
    ['developer-workspace-path', /[A-Za-z]:[\\/]+AI[\\/]+(?:video-player|zhimu-player)\b/gi],
    ['pending-author', /AUTHOR_PENDING/g],
  ]
  for (const relative of files) {
    if (/\.(png|ico)$/i.test(relative)) continue
    const content = await readFile(path.join(root, relative), 'utf8')
    for (const [rule, pattern] of rules) {
      // The scanner contains the detection expressions themselves, never account data.
      if (relative === 'scripts/public-files.mjs' && rule === 'pending-author') continue
      pattern.lastIndex = 0
      const count = [...content.matchAll(pattern)].length
      if (count) findings.push({ path: relative, rule, count })
    }
    if (/(?:^|\/)(?:config|player-state|.*cookies.*|.*credentials.*)\.json$/i.test(relative)) findings.push({ path: relative, rule: 'private-config-filename', count: 1 })
  }
  return findings
}
