import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const entries = Object.entries(lock.packages).filter(([location, data]) => location && !data.dev && !data.devOptional)
const notices = ['Third-party notices for 知幕 Zhimu Player', '',
  'Third-party components retain their original licenses. The project custom license does not replace them.',
  'Electron and Chromium notices are also distributed alongside the application executable.', '']
for (const [location, data] of entries.sort(([a], [b]) => a.localeCompare(b))) {
  const directory = path.join(root, location)
  const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name)).sort()
  notices.push('='.repeat(72), `${location.replace(/^node_modules\//, '')} ${data.version}`, `Declared license: ${data.license || 'see text'}`, '')
  if (!files.length) {
    // lazy-val 1.0.5 declares MIT and its author in package.json, but both the
    // published tarball and upstream repository omit a separate license file.
    // Record that provenance and reproduce the standard MIT permission text;
    // do not invent a copyright year or silently skip the dependency.
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
    if (metadata.name !== 'lazy-val' || metadata.version !== '1.0.5' || metadata.license !== 'MIT' || metadata.author !== 'Vladimir Krivosheev') {
      throw new Error(`No license text found for ${location}`)
    }
    const mit = await readFile(path.join(root, 'node_modules/electron-updater/LICENSE'), 'utf8')
    const permission = mit.slice(mit.indexOf('Permission is hereby granted'))
    if (!permission.startsWith('Permission is hereby granted')) throw new Error('MIT permission text unavailable')
    notices.push('Author (upstream package metadata): Vladimir Krivosheev',
      'Source: https://github.com/develar/lazy-val/blob/b69ad4119f1b19bdab13c61ee2fcc88d46b89071/package.json',
      'The upstream package declares MIT but does not include a separate license file.',
      'Standard MIT permission and disclaimer text follows:', '', permission, '')
    continue
  }
  for (const name of files) notices.push(`--- ${name} ---`, await readFile(path.join(directory, name), 'utf8'), '')
}
await mkdir(path.join(root, 'docs'), { recursive: true })
await writeFile(path.join(root, 'docs/THIRD-PARTY-NOTICES.txt'), notices.join('\n'), 'utf8')
console.log(`Third-party license texts collected: ${entries.length} packages`)
