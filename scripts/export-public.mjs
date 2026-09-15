import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { collectPublicFiles, scanPublicFiles } from './public-files.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const outputIndex = args.indexOf('--output')
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--check') continue
  if (args[index] === '--output' && args[index + 1] && !args[index + 1].startsWith('--')) { index++; continue }
  throw new Error('Usage: [--check] [--output directory]')
}
if (args.filter(arg => arg === '--output').length > 1) throw new Error('--output may only appear once')
const files = await collectPublicFiles(root)
const findings = await scanPublicFiles(root, files)
console.log(JSON.stringify({ publicFileCount: files.length, findingCount: findings.length, findings }, null, 2))
if (findings.length) process.exit(1)
if (checkOnly) process.exit(0)

const output = path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : path.join(root, 'outputs'))
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const zipName = `Zhimu-Player-${manifest.version}-Source.zip`
const prefix = `Zhimu-Player-${manifest.version}/`
const records = []
const entries = []
for (const relative of files) {
  const data = await readFile(path.join(root, relative))
  records.push({ path: relative, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') })
  entries.push({ name: prefix + relative, data })
}
entries.push({ name: prefix + 'SOURCE-MANIFEST.json', data: Buffer.from(JSON.stringify({ version: manifest.version, files: records }, null, 2) + '\n') })
if (entries.length >= 65535 || entries.reduce((size, entry) => size + entry.data.length + Buffer.byteLength(entry.name) * 2 + 100, 0) >= 0xffffffff) throw new Error('Source archive exceeds ZIP32 limits')

// A small standards-compliant ZIP writer keeps source export independent of zip tools.
// Store mode is intentional: source packages are small, and no ZIP64/binary assets are admitted.
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  return crc >>> 0
})
const crc32 = data => {
  let crc = 0xffffffff
  for (const value of data) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const local = []
const directory = []
let offset = 0
for (const entry of entries) {
  const name = Buffer.from(entry.name, 'utf8')
  const checksum = crc32(entry.data)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(33, 12) // 1980-01-01; deterministic source archive.
  header.writeUInt32LE(checksum, 14)
  header.writeUInt32LE(entry.data.length, 18)
  header.writeUInt32LE(entry.data.length, 22)
  header.writeUInt16LE(name.length, 26)
  local.push(header, name, entry.data)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(33, 14)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(entry.data.length, 20)
  central.writeUInt32LE(entry.data.length, 24)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(offset, 42)
  directory.push(central, name)
  offset += header.length + name.length + entry.data.length
}
const central = Buffer.concat(directory)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(central.length, 12)
end.writeUInt32LE(offset, 16)
const archive = Buffer.concat([...local, central, end])
await mkdir(output, { recursive: true })
await writeFile(path.join(output, zipName), archive, { flag: 'wx' })
await writeFile(path.join(output, zipName + '.sha256'), `${createHash('sha256').update(archive).digest('hex')}  ${zipName}\n`, { flag: 'wx' })
console.log(JSON.stringify({ archive: path.join(output, zipName), files: entries.length, bytes: archive.length }))
