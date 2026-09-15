import { BrowserWindow, dialog, ipcMain, net, protocol } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
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
  protocol.handle(MEDIA_SCHEME, (request) => {
    const requestUrl = new URL(request.url)
    const filePath = decodeURIComponent(requestUrl.pathname.slice(1))
    return net.fetch(pathToFileURL(filePath).href, { headers: request.headers })
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
