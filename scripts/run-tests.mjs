import { readdir, mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browser = process.argv.includes('--browser')
if (process.argv.slice(2).some(arg => arg !== '--browser')) throw new Error('Only --browser is supported')
const files = (await readdir(path.join(root, 'scripts'))).filter(name => /^test-.*\.ts$/.test(name))
  .filter(name => browser ? name === 'test-edge-cdp.ts' : name !== 'test-edge-cdp.ts').sort()
if (!files.length) throw new Error('No tests selected')
const workRoot = path.join(root, 'work')
await mkdir(workRoot, { recursive: true })
const scratch = await mkdtemp(path.join(workRoot, 'test-run-'))
try {
  for (const name of files) {
    const output = path.join(scratch, name.replace(/\.ts$/, '.cjs'))
    await build({ entryPoints: [path.join(root, 'scripts', name)], outfile: output, bundle: true,
      platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'warning' })
    const run = spawnSync(process.execPath, [output], { cwd: root, stdio: 'inherit', windowsHide: true })
    if (run.error) throw run.error
    if (run.status !== 0) throw new Error(`${name} failed (${run.signal || run.status})`)
  }
  console.log(`${files.length} test files passed${browser ? '; browser transport only, no account validation' : '; offline checks only'}`)
} finally {
  if (path.dirname(scratch) !== workRoot || !path.basename(scratch).startsWith('test-run-')) throw new Error('Invalid scratch cleanup path')
  await rm(scratch, { recursive: true, force: true })
}
