interface CdpMessage {
  id?: number
  result?: unknown
  error?: { message?: string }
}

/** Accept only Edge's generated browser endpoint, then construct the loopback URL ourselves. */
export function parseEdgeEndpoint(contents: string): string | null {
  const lines = contents.trim().split(/\r?\n/)
  if (lines.length !== 2 || !/^\d{1,5}$/.test(lines[0])) return null
  const port = Number(lines[0])
  if (port < 1 || port > 65535 || !/^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lines[1])) return null
  return `ws://127.0.0.1:${port}${lines[1]}`
}

export class EdgeCdp {
  private nextId = 1
  private failure: Error | null = null
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return
      let message: CdpMessage
      try { message = JSON.parse(event.data) } catch { return }
      if (!message || typeof message !== 'object' || typeof message.id !== 'number') return
      const request = this.pending.get(message.id)
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message || 'Edge 调试命令失败'))
      else request.resolve(message.result)
    })
    socket.addEventListener('close', () => this.fail(new Error('专用 Edge 窗口已关闭，请重新打开登录窗口。')))
    socket.addEventListener('error', () => this.fail(new Error('专用 Edge 连接中断，请重新打开登录窗口。')))
  }

  get isClosed(): boolean { return !!this.failure || this.socket.readyState !== 1 }

  private fail(error: Error): void {
    this.failure = error
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
    this.pending.clear()
  }

  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 20000): Promise<T> {
    if (this.isClosed) return Promise.reject(this.failure || new Error('专用 Edge 尚未连接。'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Edge 调试命令超时：${method}`)) }, timeoutMs)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('专用 Edge 连接中断，请重新打开登录窗口。')) }
    })
  }

  async close(): Promise<void> {
    if (!this.isClosed) { try { await this.send('Browser.close', {}, undefined, 3000) } catch { /* A browser can close before replying. */ } }
    this.fail(new Error('专用 Edge 窗口已关闭，请重新打开登录窗口。'))
    this.socket.close()
  }
}

export async function connectEdge(endpoint: string, timeoutMs = 3000): Promise<EdgeCdp> {
  const url = new URL(endpoint)
  if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash
    || parseEdgeEndpoint(`${url.port || '80'}\n${url.pathname}`) !== endpoint) throw new Error('专用 Edge 连接地址无效。')
  const socket = new WebSocket(endpoint)
  const cdp = new EdgeCdp(socket)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('专用 Edge 连接超时。')) }, timeoutMs)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('专用 Edge 尚未连接。')) }, { once: true })
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('专用 Edge 窗口已关闭，请重新打开登录窗口。')) }, { once: true })
    })
    return cdp
  } catch (error) { await cdp.close(); throw error }
}
