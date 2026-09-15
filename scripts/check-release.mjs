import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'package.json'))
const asar = require('@electron/asar')
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const resources = path.join(root, 'release/win-unpacked/resources')
const archive = path.join(resources, 'app.asar')
const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/').replace(/^\//, ''))
const files = entries.filter(name => !asar.statFile(archive, path.normalize(name)).files)
const forbidden = files.filter(name => /(?:^|\/)(?:work|outputs|state|data|.*profile)(?:\/|$)|(?:^|\/)(?:config|presets|player-state|cookies|credentials)\.json$|\.map$/.test(name))
assert.deepEqual(forbidden, [], 'private data must not enter the application archive')
const shipped = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
assert.equal(shipped.name, metadata.name)
assert.equal(shipped.productName, metadata.productName)
assert.equal(shipped.version, metadata.version)
const builtFiles = files.filter(name => name.startsWith('dist/'))
assert(builtFiles.includes('dist/main/index.js'))
assert(builtFiles.includes('dist/preload/index.js'))
assert(builtFiles.includes('dist/renderer/index.html'))
for (const name of builtFiles) assert(asar.extractFile(archive, path.normalize(name)).equals(fs.readFileSync(path.join(root, name))), name + ' differs from the current build')
for (const [source, target] of [['LICENSE', 'LICENSE'], ['NOTICE', 'NOTICE'], ['docs/LICENSE.en.md', 'LICENSE.en.md'], ['docs/THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES.txt']]) {
  assert(fs.readFileSync(path.join(root, source)).equals(fs.readFileSync(path.join(resources, target))), target + ' differs from source')
}
assert(fs.existsSync(path.join(root, 'release/win-unpacked/Zhimu Player.exe')))
console.log(JSON.stringify({ version: metadata.version, name: shipped.productName, archiveFiles: files.length, builtFilesMatched: builtFiles.length, forbiddenFiles: forbidden, licensesMatched: true, executable: 'Zhimu Player.exe' }, null, 2))
