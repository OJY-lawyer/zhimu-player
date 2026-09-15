import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const root = process.cwd()
const hostRequire = createRequire(path.join(root, 'package.json'))
const { transformSync } = hostRequire('esbuild') as typeof import('esbuild')
type WireCommand = { id: number; method: string; params: Record<string, unknown>; sessionId?: string }
type SocketEvent = { data?: unknown }

/** An event-driven socket stand-in: no browser, account, filesystem profile or network. */
class FakeSocket {
  readyState = 1
  readonly sent: WireCommand[] = []
  closeCalls = 0
  throwOnSend = false
  onSend?: (command: WireCommand) => void
  private readonly listeners = new Map<string, { callback: (event: SocketEvent) => void; once: boolean }[]>()

  addEventListener(type: string, callback: (event: SocketEvent) => void, options?: { once?: boolean }): void {
    const listeners = this.listeners.get(type) || []
    listeners.push({ callback, once: !!options?.once })
    this.listeners.set(type, listeners)
  }

  emit(type: string, event: SocketEvent = {}): void {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      if (listener.once) this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener))
      listener.callback(event)
    }
  }

  message(data: unknown): void { this.emit('message', { data }) }
  reply(id: number, result: unknown): void { this.message(JSON.stringify({ id, result })) }
  send(value: string): void {
    if (this.throwOnSend) throw new Error('fixture synchronous socket failure')
    const command = JSON.parse(value) as WireCommand
    this.sent.push(command)
    this.onSend?.(command)
  }
  close(): void { this.closeCalls++; this.readyState = 3; this.emit('close') }
}

function makeHost() {
  const timers = new Map<number, { callback: () => void; ms: number }>()
  const connections: { endpoint: string; socket: FakeSocket }[] = []
  let nextTimer = 0
  const context = vm.createContext({
    console, URL,
    WebSocket: class extends FakeSocket {
      constructor(endpoint: string) {
        super()
        this.readyState = 0
        connections.push({ endpoint, socket: this })
      }
    },
    setTimeout(callback: () => void, ms: number) {
      const id = ++nextTimer
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout(id: number) { timers.delete(id) },
  })
  const file = path.join(root, 'src/main/edgeCdp.ts')
  const source = transformSync(fs.readFileSync(file, 'utf8'), {
    loader: 'ts', format: 'cjs', target: 'node22', sourcefile: file,
  }).code
  const module = { exports: {} as typeof import('../src/main/edgeCdp') }
  vm.runInContext(`(function(require,module,exports){${source}\n})`, context)(hostRequire, module, module.exports)
  const cdpFor = (socket: FakeSocket) => new module.exports.EdgeCdp(socket as unknown as WebSocket)
  const fireTimeout = (ms: number) => {
    const match = [...timers].find(([, timer]) => timer.ms === ms)
    assert.ok(match, `expected an active ${ms} ms timeout`)
    timers.delete(match[0])
    match[1].callback()
  }
  return { ...module.exports, cdpFor, timers, connections, fireTimeout }
}

const failures: string[] = []
async function test(name: string, body: () => Promise<void> | void) {
  try { await body(); console.log(`PASS ${name}`) }
  catch (error) { failures.push(name); console.error(`FAIL ${name}`, error) }
}

async function main() {
  await test('endpoint parser accepts only a loopback port and a browser UUID', () => {
    const { parseEdgeEndpoint } = makeHost()
    const browserPath = '/devtools/browser/123e4567-e89b-12d3-a456-426614174000'
    assert.equal(parseEdgeEndpoint(`9222\n${browserPath}`), `ws://127.0.0.1:9222${browserPath}`)
    assert.equal(parseEdgeEndpoint(`65535\r\n${browserPath.toUpperCase().replace('/DEVTOOLS/BROWSER/', '/devtools/browser/')}\r\n`),
      `ws://127.0.0.1:65535${browserPath.toUpperCase().replace('/DEVTOOLS/BROWSER/', '/devtools/browser/')}`)
    assert.equal(parseEdgeEndpoint(`1\n${browserPath}`), `ws://127.0.0.1:1${browserPath}`)
    for (const contents of [
      '', '9222', `0\n${browserPath}`, `65536\n${browserPath}`, `-1\n${browserPath}`,
      `1.5\n${browserPath}`, `1e3\n${browserPath}`, `+9222\n${browserPath}`,
      `9222\n${browserPath}\nextra`, `9222\n/devtools/page/123e4567-e89b-12d3-a456-426614174000`,
      `9222\n/devtools/browser/${'-'.repeat(36)}`, `9222\n/devtools/browser/${'a'.repeat(36)}`,
      `9222\n${browserPath}?token=unexpected`, `9222\n${browserPath}/extra`,
      `evil.example:9222\n${browserPath}`, `9222\nws://evil.example${browserPath}`,
      `ws://127.0.0.1:9222${browserPath}`, `9222\n//evil.example${browserPath}`,
    ]) assert.equal(parseEdgeEndpoint(contents), null, `must reject ${JSON.stringify(contents)}`)
  })

  await test('out-of-order replies and session commands resolve only their own request', async () => {
    const host = makeHost()
    const socket = new FakeSocket()
    const cdp = host.cdpFor(socket)
    const first = cdp.send<{ product: string }>('Browser.getVersion')
    const second = cdp.send<{ value: number }>('Runtime.evaluate', { expression: '2 + 2' }, 'page-session')
    assert.equal(socket.sent[0].sessionId, undefined)
    assert.deepEqual(socket.sent[1], { id: 2, method: 'Runtime.evaluate', params: { expression: '2 + 2' }, sessionId: 'page-session' })
    socket.reply(2, { value: 4 })
    assert.equal((await second).value, 4)
    assert.equal(host.timers.size, 1, 'the unrelated browser request remains pending')
    socket.reply(1, { product: 'fixture Edge' })
    assert.equal((await first).product, 'fixture Edge')
    assert.equal(host.timers.size, 0)
  })

  await test('notifications, malformed messages and unknown replies do not settle pending work', async () => {
    const host = makeHost()
    const socket = new FakeSocket()
    const cdp = host.cdpFor(socket)
    const result = cdp.send<{ ok: boolean }>('Runtime.evaluate', {}, 'page-session')
    for (const data of [
      'not JSON', 'null', '[]', 'false', '42', '{}',
      JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 1 } }),
      JSON.stringify({ id: 999, result: {} }), JSON.stringify({ id: '1', result: {} }),
      Buffer.from('{"id":1,"result":{}}'), { id: 1, result: {} },
    ]) socket.message(data)
    assert.equal(host.timers.size, 1)
    socket.reply(1, { ok: true })
    assert.equal((await result).ok, true)
    socket.reply(1, { ok: false })
    assert.equal(host.timers.size, 0)
  })

  await test('CDP command errors reject the matching request and clear its deadline', async () => {
    const host = makeHost()
    const socket = new FakeSocket()
    const cdp = host.cdpFor(socket)
    const rejected = assert.rejects(cdp.send('Runtime.evaluate'), /fixture protocol failure/)
    socket.message(JSON.stringify({ id: 1, error: { message: 'fixture protocol failure' } }))
    await rejected
    assert.equal(host.timers.size, 0)
    const genericError = assert.rejects(cdp.send('Runtime.evaluate'), /Edge 调试命令失败/)
    socket.message(JSON.stringify({ id: 2, error: {} }))
    await genericError
    assert.equal(host.timers.size, 0)
  })

  await test('socket close or error rejects every pending request and future sends immediately', async () => {
    for (const event of ['close', 'error']) {
      const host = makeHost()
      const socket = new FakeSocket()
      const cdp = host.cdpFor(socket)
      const pending = Promise.allSettled([cdp.send('Browser.getVersion'), cdp.send('Runtime.evaluate', {}, 'page-session')])
      if (event === 'close') socket.readyState = 3
      socket.emit(event)
      const results = await pending
      assert.ok(results.every(result => result.status === 'rejected' && /已关闭|连接中断/.test(String(result.reason))))
      assert.equal(cdp.isClosed, true)
      assert.equal(host.timers.size, 0)
      await assert.rejects(cdp.send('Browser.getVersion'), /已关闭|连接中断/)
      assert.equal(socket.sent.length, 2)
      assert.equal(host.timers.size, 0)
    }
  })

  await test('synchronous send failures reject without leaving a pending request or deadline', async () => {
    const host = makeHost()
    const socket = new FakeSocket()
    const cdp = host.cdpFor(socket)
    socket.throwOnSend = true
    await assert.rejects(cdp.send('Browser.getVersion'), /连接中断/)
    assert.equal(host.timers.size, 0)
    socket.throwOnSend = false
    const next = cdp.send<{ ok: boolean }>('Browser.getVersion')
    socket.reply(socket.sent[0].id, { ok: true })
    assert.equal((await next).ok, true)
    assert.equal(host.timers.size, 0)
  })

  await test('command deadlines reject only the timed-out request and ignore its late reply', async () => {
    const host = makeHost()
    const socket = new FakeSocket()
    const cdp = host.cdpFor(socket)
    const timedOut = assert.rejects(cdp.send('Runtime.evaluate', {}, 'page-session', 75), /超时.*Runtime.evaluate/)
    const other = cdp.send<{ ok: boolean }>('Browser.getVersion')
    host.fireTimeout(75)
    await timedOut
    socket.reply(1, { late: true })
    assert.equal(host.timers.size, 1)
    socket.reply(2, { ok: true })
    assert.equal((await other).ok, true)
    assert.equal(host.timers.size, 0)
  })

  await test('close asks the browser to exit and tolerates disconnection before its reply', async () => {
    for (const behavior of ['reply', 'disconnect', 'timeout']) {
      const host = makeHost()
      const socket = new FakeSocket()
      const cdp = host.cdpFor(socket)
      const unrelated = assert.rejects(cdp.send('Runtime.evaluate'), /已关闭/)
      socket.onSend = command => {
        if (command.method !== 'Browser.close') return
        if (behavior === 'reply') socket.reply(command.id, {})
        if (behavior === 'disconnect') { socket.readyState = 3; socket.emit('close') }
      }
      const closed = cdp.close()
      assert.equal(socket.sent[1].method, 'Browser.close')
      assert.equal(socket.sent[1].sessionId, undefined, 'Browser.close is a browser-level command')
      if (behavior === 'timeout') host.fireTimeout(3000)
      await closed
      await unrelated
      assert.equal(socket.closeCalls, 1)
      assert.equal(cdp.isClosed, true)
      assert.equal(host.timers.size, 0)
      await assert.rejects(cdp.send('Browser.getVersion'), /已关闭/)
    }
  })

  await test('connection becomes usable only after open, and failure paths close the socket', async () => {
    const endpoint = 'ws://127.0.0.1:9222/devtools/browser/123e4567-e89b-12d3-a456-426614174000'
    const host = makeHost()
    const connecting = host.connectEdge(endpoint)
    assert.equal(host.connections[0].endpoint, endpoint)
    const socket = host.connections[0].socket
    socket.readyState = 1
    socket.emit('open')
    const cdp = await connecting
    assert.equal(cdp.isClosed, false)
    assert.equal(host.timers.size, 0)
    const result = cdp.send<{ product: string }>('Browser.getVersion')
    socket.reply(1, { product: 'fixture Edge' })
    assert.equal((await result).product, 'fixture Edge')
    socket.emit('close')

    for (const failure of ['error', 'close', 'timeout']) {
      const failedHost = makeHost()
      const rejected = assert.rejects(failedHost.connectEdge(endpoint, 80), /尚未连接|已关闭|超时/)
      const failedSocket = failedHost.connections[0].socket
      if (failure === 'timeout') failedHost.fireTimeout(80)
      else failedSocket.emit(failure)
      await rejected
      assert.ok(failedSocket.closeCalls >= 1)
      assert.equal(failedHost.timers.size, 0)
    }
  })

  await test('connect refuses remote, credential-bearing and malformed endpoints before constructing a socket', async () => {
    const host = makeHost()
    const browserPath = '/devtools/browser/123e4567-e89b-12d3-a456-426614174000'
    for (const endpoint of [
      `ws://evil.example:9222${browserPath}`, `ws://localhost:9222${browserPath}`,
      `wss://127.0.0.1:9222${browserPath}`, `http://127.0.0.1:9222${browserPath}`,
      `ws://name:secret@127.0.0.1:9222${browserPath}`, `ws://127.0.0.1:0${browserPath}`,
      `ws://127.0.0.1:65536${browserPath}`, `ws://127.0.0.1:9222${browserPath}?token=value`,
      `ws://127.0.0.1:9222${browserPath}#fragment`, `ws://127.0.0.1:9222${browserPath}/extra`,
      'ws://127.0.0.1:9222/devtools/browser/not-a-uuid', 'not a URL',
    ]) await assert.rejects(host.connectEdge(endpoint))
    assert.equal(host.connections.length, 0)
    assert.equal(host.timers.size, 0)
  })

  if (failures.length) throw new Error(`${failures.length} Edge transport regression(s) failed: ${failures.join(', ')}`)
  console.log('Edge WebSocket transport: offline fixtures passed; no browser or account was used')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
