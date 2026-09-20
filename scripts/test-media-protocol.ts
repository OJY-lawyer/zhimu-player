import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { buildSync } = hostRequire('esbuild') as typeof import('esbuild')
const file = path.join(root, 'work', 'virtual-media-fixture.mp4')
const emptyFile = path.join(root, 'work', 'virtual-empty-fixture.mp4')
const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index))
let handler: (request: Request) => Promise<Response>
let openCount = 0
let lastStream: Readable | undefined
let holdReadStream = false
const module = { exports: {} as any }
const electron = { protocol: { handle(name: string, callback: typeof handler) { assert.equal(name, 'local-video'); handler = callback } } }
const disk = {
  promises: { async stat(requested: string) {
    if (requested !== file && requested !== emptyFile) throw Object.assign(new Error('fixture missing'), { code: 'ENOENT' })
    return { isFile: () => true, size: requested === file ? bytes.length : 0 }
  } },
  createReadStream(requested: string, options: { start: number; end: number; signal: AbortSignal }) {
    assert.equal(requested, file)
    openCount++
    lastStream = holdReadStream ? new Readable({ read() {}, signal: options.signal })
      : Readable.from([bytes.subarray(options.start, options.end + 1)], { signal: options.signal })
    return lastStream
  },
}
const compiled = buildSync({ entryPoints: [path.join(root, 'src/main/mediaFiles.ts')], bundle: true, platform: 'node', format: 'cjs', target: 'node22', write: false, external: ['electron'] }).outputFiles[0].text
const context = vm.createContext({ console, Buffer, URL, Request, Response, Headers, ReadableStream, AbortController })
vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)((name: string) => name === 'electron' ? electron : name === 'fs' || name === 'node:fs' ? disk : hostRequire(name), module, module.exports)
module.exports.registerMediaProtocol()
const mediaUrl = (name = file) => `local-video://file/${encodeURIComponent(name)}`
const request = (range?: string, method = 'GET', name = file) => handler(new Request(mediaUrl(name), { method, headers: range ? { Range: range } : {} }))

async function main() {
  const whole = await request()
  assert.equal(whole.status, 200)
  assert.equal(whole.headers.get('content-type'), 'video/mp4')
  assert.equal(whole.headers.get('content-length'), '256')
  assert.equal(whole.headers.get('accept-ranges'), 'bytes')
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes)
  for (const [range, expectedRange, start, end] of [
    ['bytes=0-31', 'bytes 0-31/256', 0, 31],
    ['bytes=64-', 'bytes 64-255/256', 64, 255],
    ['bytes=-8', 'bytes 248-255/256', 248, 255],
    ['bytes=250-999', 'bytes 250-255/256', 250, 255],
    ['bytes=-999', 'bytes 0-255/256', 0, 255],
    ['bytes=0-0', 'bytes 0-0/256', 0, 0],
  ] as const) {
    const result = await request(range)
    assert.equal(result.status, 206, range)
    assert.equal(result.headers.get('content-range'), expectedRange)
    assert.equal(result.headers.get('content-length'), String(end - start + 1))
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes.subarray(start, end + 1), range)
  }
  const countBeforeHead = openCount
  const head = await request('bytes=10-19', 'HEAD')
  assert.equal(head.status, 206)
  assert.equal(head.headers.get('content-range'), 'bytes 10-19/256')
  assert.equal(head.headers.get('content-length'), '10')
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  assert.equal(openCount, countBeforeHead, 'HEAD must not open the media body')
  for (const range of ['bytes=256-', 'bytes=20-10', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-8', 'items=0-4', 'bytes=999999999999999999-', 'bytes=0-999999999999999999']) {
    const result = await request(range)
    assert.equal(result.status, 416, range)
    assert.equal(result.headers.get('content-range'), 'bytes */256')
    assert.equal((await result.arrayBuffer()).byteLength, 0)
  }
  const empty = await request(undefined, 'GET', emptyFile)
  assert.equal(empty.status, 200)
  assert.equal(empty.headers.get('content-length'), '0')
  assert.equal((await empty.arrayBuffer()).byteLength, 0)
  assert.equal((await request('bytes=0-', 'GET', emptyFile)).status, 416)
  assert.equal((await request(undefined, 'POST')).status, 405)
  assert.equal((await request(undefined, 'GET', path.join(root, 'work', 'missing.mp4'))).status, 404)
  assert.equal((await request(undefined, 'GET', path.join(root, 'work', 'private.txt'))).status, 400)
  assert.equal((await handler(new Request('local-video://elsewhere/' + encodeURIComponent(file)))).status, 400)
  holdReadStream = true
  const cancellable = await request('bytes=10-')
  assert.equal(lastStream?.destroyed, false, 'the pending stream is still open before cancellation')
  await cancellable.body!.cancel()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(lastStream?.destroyed, true, 'cancelling a seek request releases its old file stream')
  console.log('media-protocol: exact 200/206 ranges and bytes, HEAD, suffix/open ranges, invalid ranges, cancellation and safe errors passed; no real media or account files read')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
