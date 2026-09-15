import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import https from 'node:https'
import path from 'node:path'

// The web workflow follows the existing Tingwu web client protocol. It is not
// Alibaba Cloud's paid OpenAPI, and may need updating when the website changes.
const API_ROOT = 'https://tingwu.aliyun.com/api'
const MAX_UPLOAD_BYTES = 5 * 1024 ** 3
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
}

export interface TingwuAuthResult {
  success: boolean
  authenticated: boolean
  message: string
}

type ResponseLike = Pick<Response, 'ok' | 'status' | 'json'>
export type TingwuFetch = (url: string, options: RequestInit) => Promise<ResponseLike>
export type TingwuProgress = (message: string, percent?: number) => void
export interface TingwuUpload {
  transId: string
  putLink?: string
  getLink?: string
  sts?: {
    accessKeyId: string
    accessKeySecret: string
    securityToken: string
    endpoint: string
    bucket: string
    fileKey: string
  }
}

export class TingwuError extends Error {
  constructor(message: string, public readonly authentication = false) {
    super(message)
    this.name = 'TingwuError'
  }
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError')
}

export async function delay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfCancelled(signal)
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export async function inspectTingwuMedia(filePath: string): Promise<{ size: number; key: string; contentType: string }> {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !MIME[path.extname(filePath).toLowerCase()]) {
    throw new TingwuError('听悟支持此播放器中的 MP4、MKV、AVI、WEBM、MOV 和 M4V；TS 请先转换为 MP4。')
  }
  const stats = await fs.stat(filePath)
  if (!stats.isFile() || stats.size === 0 || stats.size > MAX_UPLOAD_BYTES) {
    throw new TingwuError('请选择有效且不超过 5 GB 的视频文件。')
  }
  const canonicalPath = await fs.realpath(filePath)
  const key = createHash('sha256').update(`${canonicalPath}\0${stats.size}\0${stats.mtimeMs}`).digest('hex')
  return { size: stats.size, key, contentType: MIME[path.extname(filePath).toLowerCase()] }
}

export class TingwuClient {
  constructor(private readonly fetcher: TingwuFetch) {}

  private async request(apiPath: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    throwIfCancelled(signal)
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const trace = randomUUID().replace(/-/g, '')
      const response = await this.fetcher(`${API_ROOT}${apiPath}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include', redirect: 'error', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*',
          'x-b3-traceid': trace, 'x-b3-spanid': trace.slice(0, 16), 'x-b3-sampled': '1',
          'x-tw-canary': '', Referer: 'https://tingwu.aliyun.com/home',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (response.status === 401 || response.status === 403) {
        throw new TingwuError('听悟登录已失效或请求被拦截，请重新登录。', true)
      }
      if (!response.ok) throw new TingwuError(`听悟暂不可用（HTTP ${response.status}），请稍后重试。`)
      const envelope = asRecord(await response.json())
      if (String(envelope.code) !== '0') {
        const authentication = /login|登录|未认证|过期|unauthor/i.test(String(envelope.message ?? ''))
        throw new TingwuError(authentication
          ? '请先登录听悟，或重新登录后重试。'
          : '听悟未接受此请求，请在听悟网页检查账户额度和任务状态。', authentication)
      }
      return envelope.data
    } catch (error) {
      throwIfCancelled(signal)
      if (error instanceof TingwuError) throw error
      // Do not surface provider payloads, signed URLs, cookies or STS credentials.
      throw new TingwuError('无法连接听悟，请检查网络和登录状态后重试。')
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }

  async probe(signal = new AbortController().signal): Promise<TingwuAuthResult> {
    try {
      const user = await this.request('/account/v2/user/info?c=web', undefined, signal)
      if (!user || typeof user !== 'object' || Object.keys(user).length === 0) {
        throw new TingwuError('尚未检测到听悟登录，请登录后重试。', true)
      }
      return { success: true, authenticated: true, message: '听悟已登录，可以生成字幕。' }
    } catch (error) {
      return { success: error instanceof TingwuError && error.authentication, authenticated: false,
        message: error instanceof TingwuError ? error.message : '听悟登录状态检测未完成。' }
    }
  }

  async generateUpload(filePath: string, size: number, contentType: string, taskId: string, signal: AbortSignal, language: 'cn' | 'en' = 'cn'): Promise<TingwuUpload> {
    const extension = path.extname(filePath).toLowerCase()
    const result = asRecord(await this.request('/trans/request?generatePutLink=', {
      action: 'generatePutLink', version: '1.0', taskId, useSts: 1, fileSize: size,
      dirId: 0, fileContentType: contentType,
      tag: {
        showName: path.basename(filePath, extension).slice(0, 150), fileFormat: extension.slice(1),
        fileType: 'local', lang: language, roleSplitNum: 2, translateSwitch: false,
        transTargetValue: '', originalFlag: 0, originalTag: JSON.stringify({ isVideo: 1 }),
      },
    }, signal))
    if (typeof result.transId !== 'string' || !result.transId) {
      throw new TingwuError('听悟没有返回有效任务编号；为避免重复提交，已停止。')
    }
    return result as unknown as TingwuUpload
  }

  async confirmUpload(upload: TingwuUpload, size: number, signal: AbortSignal): Promise<void> {
    const fileLink = upload.putLink || upload.getLink
    if (!fileLink) throw new TingwuError('听悟上传信息不完整，已停止确认任务。')
    await this.request('/trans/request?syncPutLink=', {
      action: 'syncPutLink', version: '1.0', fileLink, fileSize: size, transId: upload.transId,
    }, signal)
  }

  async taskStatus(transId: string, signal: AbortSignal): Promise<number | null> {
    const result = await this.request('/trans/request?getTransList=', {
      action: 'getTransList', version: '1.0', userId: '',
      filter: { status: [0, 1, 2, 3, 4, 11] }, preview: 1, pageNo: 1, pageSize: 1000,
    }, signal)
    if (!Array.isArray(result)) throw new TingwuError('听悟任务列表格式已变化，需要更新播放器。')
    const task = result.map(asRecord).find(item => String(item.transId) === transId)
    return task ? Number(task.status) : null
  }

  async waitForSrt(transId: string, signal: AbortSignal, progress: TingwuProgress): Promise<string> {
    const uploadGraceDeadline = Date.now() + 120_000
    const deadline = Date.now() + 60 * 60_000
    while (Date.now() < deadline) {
      const status = await this.taskStatus(transId, signal)
      if (status === 4) throw new TingwuError('听悟云端转写失败，请在听悟网页查看该任务。')
      if (status === 0 || status === 3) {
        const resultDeadline = Date.now() + 120_000
        do {
          const result = asRecord(await this.request('/trans/getTransResult?c=web', {
            action: 'getTransResult', version: '1.0', transId,
          }, signal))
          const srt = tingwuResultToSrt(result.result)
          if (srt) return srt
          if (result.duration != null && result.wordCount != null && Number(result.wordCount) === 0) {
            throw new TingwuError('听悟已完成任务，但没有识别到可生成字幕的语音。')
          }
          progress('转写已完成，等待字幕正文就绪…')
          await delay(2_000, signal)
        } while (Date.now() < resultDeadline)
        throw new TingwuError('听悟字幕正文尚未就绪；稍后重试会继续读取原任务。')
      }
      if (status === 11 && Date.now() >= uploadGraceDeadline) throw new TingwuError('听悟仍显示上传中，请在听悟网页检查任务后重试。')
      progress(status === 2 ? '听悟正在转写…' : status === 1 ? '听悟正在排队…' : '等待云端任务出现…')
      await delay(10_000, signal)
    }
    throw new TingwuError('等待听悟超过一小时，已停止本地等待；重试会继续读取原任务。')
  }
}

export function buildOssUpload(upload: TingwuUpload, contentType: string, date = new Date().toUTCString()): { url: URL; headers: Record<string, string> } {
  const sts = upload.sts
  if (sts) {
    if (![sts.accessKeyId, sts.accessKeySecret, sts.securityToken, sts.endpoint, sts.bucket, sts.fileKey]
      .every(value => typeof value === 'string' && value.length > 0 && !/[\r\n]/.test(value))) {
      throw new TingwuError('听悟临时上传凭证不完整。')
    }
    const endpoint = new URL(sts.endpoint.includes('://') ? sts.endpoint : `https://${sts.endpoint}`)
    if (!/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(endpoint.hostname)
      || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(sts.bucket)
      || endpoint.username || endpoint.password || endpoint.port || !['https:', 'http:'].includes(endpoint.protocol)
      || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
      throw new TingwuError('听悟返回了非预期的上传地址，已停止上传。')
    }
    const key = sts.fileKey.replace(/^\//, '')
    if (key.split('/').some(part => part === '.' || part === '..')) throw new TingwuError('听悟上传对象路径无效。')
    const url = new URL(`https://${sts.bucket}.${endpoint.hostname}/${key.split('/').map(encodeURIComponent).join('/')}`)
    // Alibaba Cloud OSS V1 canonical signing, including the STS security token:
    // https://www.alibabacloud.com/help/en/oss/include-signatures-in-the-authorization-header
    const signature = createHmac('sha1', sts.accessKeySecret)
      .update(`PUT\n\n${contentType}\n${date}\nx-oss-security-token:${sts.securityToken}\n/${sts.bucket}/${key}`)
      .digest('base64')
    return { url, headers: { 'Content-Type': contentType, Date: date,
      'x-oss-security-token': sts.securityToken, Authorization: `OSS ${sts.accessKeyId}:${signature}` } }
  }
  let url: URL
  try { url = new URL(upload.putLink || '') } catch { throw new TingwuError('听悟未提供可用上传地址。') }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)
    || url.username || url.password || url.port) {
    throw new TingwuError('听悟返回了非预期的上传地址，已停止上传。')
  }
  return { url, headers: { 'Content-Type': contentType } }
}

export function uploadTingwuMedia(filePath: string, size: number, contentType: string, upload: TingwuUpload,
  signal: AbortSignal, progress: TingwuProgress): Promise<void> {
  throwIfCancelled(signal)
  const target = buildOssUpload(upload, contentType)
  return new Promise((resolve, reject) => {
    const input = createReadStream(filePath)
    let settled = false
    let sent = 0
    let lastPercent = -1
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      input.destroy()
      request.destroy()
      error ? reject(error) : resolve()
    }
    // This request deliberately uses Node HTTPS, with no browser session cookies.
    // Redirects are never followed, so temporary credentials cannot change host.
    const request = https.request(target.url, {
      method: 'PUT', headers: { ...target.headers, 'Content-Length': String(size) },
    }, response => {
      response.resume()
      response.on('error', () => finish(new TingwuError('上传响应中断；请检查听悟任务状态。')))
      response.on('end', () => finish(response.statusCode && response.statusCode >= 200 && response.statusCode < 300
        ? undefined : new TingwuError('听悟文件上传失败，请检查网络或重新登录。')))
    })
    const onAbort = () => finish(new DOMException('已取消', 'AbortError'))
    const timer = setTimeout(() => finish(new TingwuError('听悟上传超过 30 分钟，已停止。')), 30 * 60_000)
    signal.addEventListener('abort', onAbort, { once: true })
    request.on('error', () => finish(new TingwuError('听悟上传连接中断，请检查网络。')))
    input.on('error', () => finish(new TingwuError('无法读取待上传的视频文件。')))
    input.on('data', chunk => {
      sent += chunk.length
      const percent = Math.min(100, Math.floor(sent / size * 100))
      if (percent !== lastPercent) { lastPercent = percent; progress(`上传进度：${percent}%`, percent) }
    })
    input.pipe(request)
  })
}

function timestamp(milliseconds: number): string {
  const ms = Math.max(0, Math.floor(milliseconds))
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

export function tingwuResultToSrt(raw: unknown): string {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return '' }
  }
  const pages = asRecord(parsed).pg
  if (!Array.isArray(pages)) return ''
  const cues: { start: number; end: number; text: string }[] = []
  for (const page of pages) {
    const segments = asRecord(page).sc
    if (!Array.isArray(segments)) continue
    let current: { start: number; end: number; text: string } | undefined
    const flush = () => { if (current?.text.trim()) cues.push({ ...current, text: current.text.trim() }); current = undefined }
    for (const item of segments) {
      const segment = asRecord(item)
      const start = Number(segment.bt)
      const end = Number(segment.et)
      const text = typeof segment.tc === 'string' ? segment.tc.replace(/[\r\n]+/g, ' ') : ''
      if (!text || segment.bt == null || segment.et == null || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) continue
      if (current && start - current.end > 1500) flush()
      current = current ? { ...current, end: Math.max(end, current.end), text: current.text + text } : { start, end, text }
      const duration = current.end - current.start
      if (/[。！？!?]$/.test(current.text) || duration >= 6000 || current.text.length >= 32
        || (/[，、；,;]$/.test(current.text) && (duration >= 3500 || current.text.length >= 18))) flush()
    }
    flush()
  }
  return cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`).join('\n')
}
