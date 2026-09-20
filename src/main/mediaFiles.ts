import { BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import * as path from 'path'
import { Readable } from 'node:stream'
import { nativeText } from './locale'
import {
  VIDEO_EXTENSIONS,
  type MediaDropSelection,
  type MediaFile,
  type MediaFolderSelection,
  type VideoExtension
} from '../shared/contracts'

type WindowProvider = () => BrowserWindow | null

const extensionSet = new Set<string>(VIDEO_EXTENSIONS)
export const MEDIA_SCHEME = 'local-video'
const naturalNameCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
})

function toMediaFile(filePath: string): MediaFile {
  const extension = path.extname(filePath).slice(1).toLowerCase() as VideoExtension
  const name = path.basename(filePath)

  return {
    path: filePath,
    url: `${MEDIA_SCHEME}://file/${encodeURIComponent(filePath)}`,
    name,
    stem: path.basename(filePath, path.extname(filePath)),
    extension
  }
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    let filePath: string
    try {
      const url = new URL(request.url)
      filePath = decodeURIComponent(url.pathname.slice(1))
      if (url.hostname !== 'file' || !path.isAbsolute(filePath) || !isVideoFile(filePath)) return new Response(null, { status: 400 })
    } catch { return new Response(null, { status: 400 }) }
    let size: number
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return new Response(null, { status: 404 })
      size = stat.size
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return new Response(null, { status: code === 'EACCES' || code === 'EPERM' ? 403 : 404 })
    }
    const mime: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', ts: 'video/mp2t' }
    const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Content-Type': mime[path.extname(filePath).slice(1).toLowerCase()] || 'application/octet-stream' })
    let start = 0, end = size - 1, status = 200
    const range = request.headers.get('range')
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
      const first = match?.[1] ? Number(match[1]) : null
      const last = match?.[2] ? Number(match[2]) : null
      if (!match || first === null && last === null || size === 0
        || first !== null && (!Number.isSafeInteger(first) || first >= size)
        || last !== null && !Number.isSafeInteger(last)
        || first === null && (last === null || last <= 0)
        || first !== null && last !== null && last < first) {
        headers.set('Content-Range', `bytes */${size}`)
        return new Response(null, { status: 416, headers })
      }
      start = first === null ? Math.max(0, size - last!) : first
      end = first === null || last === null ? size - 1 : Math.min(last, size - 1)
      status = 206
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    }
    headers.set('Content-Length', String(size === 0 ? 0 : end - start + 1))
    // net.fetch(file:) forwards the byte slice but drops its HTTP range metadata. Chromium then
    // treats a partially buffered file as unseekable. Serve a bounded stream with explicit ranges.
    if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
    const stream = createReadStream(filePath, { start, end, signal: request.signal })
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  })
}

function isVideoFile(fileName: string): boolean {
  return extensionSet.has(path.extname(fileName).slice(1).toLowerCase())
}

export async function scanVideoDirectory(folderPath: string): Promise<MediaFile[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true })

  return entries
    .filter((entry) => entry.isFile() && isVideoFile(entry.name))
    .sort((left, right) => naturalNameCollator.compare(left.name, right.name))
    .map((entry) => toMediaFile(path.join(folderPath, entry.name)))
}

export async function resolveMediaFile(filePath: string): Promise<MediaFile | null> {
  if (!isVideoFile(filePath)) return null

  try {
    const stats = await fs.stat(filePath)
    return stats.isFile() ? toMediaFile(filePath) : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function resolveDroppedMediaPath(droppedPath: string): Promise<MediaDropSelection | null> {
  try {
    const stats = await fs.stat(droppedPath)
    if (stats.isDirectory()) {
      return {
        sourceKind: 'folder',
        sourcePath: droppedPath,
        displayName: path.basename(droppedPath),
        files: await scanVideoDirectory(droppedPath),
      }
    }

    const media = stats.isFile() ? await resolveMediaFile(droppedPath) : null
    return media ? {
      sourceKind: 'single-video',
      sourcePath: media.path,
      displayName: media.stem,
      files: [media],
    } : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function showOpenDialog(
  getWindow: WindowProvider,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const window = getWindow()
  return window && !window.isDestroyed()
    ? dialog.showOpenDialog(window, options)
    : dialog.showOpenDialog(options)
}

export function registerMediaFileIpc(getWindow: WindowProvider): void {
  ipcMain.handle('select-video-file', async (): Promise<MediaFile | null> => {
    const result = await showOpenDialog(getWindow, {
      properties: ['openFile'],
      filters: [{ name: nativeText('视频文件', 'Video files'), extensions: [...VIDEO_EXTENSIONS] }]
    })

    return result.canceled ? null : toMediaFile(result.filePaths[0])
  })

  ipcMain.handle('select-video-folder', async (): Promise<MediaFolderSelection | null> => {
    const result = await showOpenDialog(getWindow, { properties: ['openDirectory'] })
    if (result.canceled) return null

    const folderPath = result.filePaths[0]
    return {
      folderPath,
      folderName: path.basename(folderPath),
      files: await scanVideoDirectory(folderPath)
    }
  })

  ipcMain.handle('scan-video-directory', (_event, folderPath: string) =>
    scanVideoDirectory(folderPath)
  )

  ipcMain.handle('resolve-media-file', (_event, filePath: string) =>
    resolveMediaFile(filePath)
  )

  ipcMain.handle('resolve-dropped-media', (_event, droppedPath: string) =>
    resolveDroppedMediaPath(droppedPath)
  )
}
