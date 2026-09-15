import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { AsrProgress, AsrRunResult } from '../shared/contracts'
import { createTingwuClient, disposeTingwuSession, logoutTingwu, openTingwuLogin } from './tingwuSession'
import { inspectTingwuMedia, TingwuError, throwIfCancelled, uploadTingwuMedia, type TingwuAuthResult } from './tingwuClient'
import { parseSRT } from '../renderer/utils/srtParser'

type WindowProvider = () => BrowserWindow | null
type TaskStage = 'creating' | 'uploading' | 'syncing' | 'transcribing' | 'completed'
interface TaskRecord { localTaskId: string; transId?: string; stage: TaskStage; updatedAt: string }
type TaskHistory = Record<string, TaskRecord>
let activeRun: AbortController | null = null

export function extractAsrProgress(message: string): Pick<AsrProgress, 'message' | 'percent'> {
  const percent = message.match(/(\d{1,3})%/)?.[1]
  return { message, percent: percent === undefined ? undefined : Math.min(100, Number(percent)) }
}

function expectedSrtPath(videoPath: string): string {
  return path.join(path.dirname(videoPath), path.basename(videoPath, path.extname(videoPath)) + '.srt')
}

function publish(getWindow: WindowProvider, progress: AsrProgress): void {
  const window = getWindow()
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('asr-progress', progress)
  }
}

function requirePlayer(event: IpcMainInvokeEvent, getWindow: WindowProvider): void {
  const window = getWindow()
  if (!window || window.isDestroyed() || event.sender !== window.webContents
    || event.senderFrame !== window.webContents.mainFrame) throw new Error('不允许此窗口访问字幕功能。')
}

async function loadHistory(historyPath: string): Promise<TaskHistory> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(historyPath, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid history')
    const entries = Object.entries(value)
    if (!entries.every(([key, item]) => /^[a-f0-9]{64}$/.test(key) && item && typeof item === 'object'
      && typeof item.localTaskId === 'string' && ['creating', 'uploading', 'syncing', 'transcribing', 'completed'].includes(item.stage)
      && (item.transId === undefined || typeof item.transId === 'string'))) throw new Error('invalid history')
    return value as TaskHistory
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new TingwuError('听悟任务记录无法读取；为避免重复上传，已停止。请恢复播放器数据后重试。')
  }
}

async function saveHistory(historyPath: string, history: TaskHistory): Promise<void> {
  const temp = `${historyPath}.tmp`
  await fs.mkdir(path.dirname(historyPath), { recursive: true })
  await fs.writeFile(temp, JSON.stringify(history, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, historyPath)
}

async function writeSrtWithoutReplacing(output: string, content: string): Promise<void> {
  // Never replace subtitles created/corrected during the cloud operation.
  const temp = `${output}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' })
    try { await fs.copyFile(temp, output, constants.COPYFILE_EXCL) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  } finally { await fs.unlink(temp).catch(() => {}) }
}

export function registerAsrWorker(getWindow: WindowProvider): void {
  ipcMain.handle('asr-probe', async (event): Promise<TingwuAuthResult> => {
    requirePlayer(event, getWindow)
    return createTingwuClient().probe()
  })
  ipcMain.handle('asr-login', (event): Promise<TingwuAuthResult> => {
    requirePlayer(event, getWindow)
    if (activeRun) return Promise.resolve({ success: false, authenticated: false, message: '请先完成或取消字幕任务，再重新登录。' })
    return openTingwuLogin(getWindow())
  })
  ipcMain.handle('asr-logout', async (event): Promise<TingwuAuthResult> => {
    requirePlayer(event, getWindow)
    if (activeRun) return { success: false, authenticated: true, message: '请先取消字幕任务，再退出听悟登录。' }
    try { return await logoutTingwu() } catch {
      return { success: false, authenticated: false, message: '清除听悟登录未完成，请重启播放器后重试。' }
    }
  })

  ipcMain.handle('asr-start', async (event, videoPaths: unknown, language: 'cn' | 'en' = 'cn'): Promise<AsrRunResult> => {
    requirePlayer(event, getWindow)
    if (activeRun) return { success: false, message: '已有字幕任务正在运行。' }
    if (language !== 'cn' && language !== 'en') return { success: false, message: '不支持的转写语言，请选择中文或 English。' }
    if (!Array.isArray(videoPaths) || videoPaths.length === 0 || videoPaths.length > 500
      || !videoPaths.every(item => typeof item === 'string' && path.isAbsolute(item))) {
      return { success: false, message: '请选择 1 至 500 个有效视频文件。' }
    }
    const pending = [...new Set(videoPaths as string[])].filter(filePath => !existsSync(expectedSrtPath(filePath)))
    const controller = new AbortController()
    activeRun = controller
    const signal = controller.signal
    const finish = (result: AsrRunResult, status: AsrProgress['status']): AsrRunResult => {
      publish(getWindow, { status, message: result.message }); return result
    }
    try {
      for (const videoPath of videoPaths) {
        const output = expectedSrtPath(videoPath)
        if (existsSync(output) && !parseSRT(await fs.readFile(output, 'utf8')).some(cue => cue.text.trim())) {
          throw new TingwuError('同名字幕为空或无法解析，已保留原文件。请先将这份 SRT 更名备份，再重新生成字幕。')
        }
      }
      if (pending.length === 0) return finish({ success: true, message: '已发现有效同名字幕，播放器将直接重新加载。' }, 'completed')
      // Validate the entire batch before making the first external write.
      const inspected = []
      const outputOwners = new Set<string>()
      for (const filePath of pending) {
        const output = expectedSrtPath(filePath).toLowerCase()
        if (outputOwners.has(output)) throw new TingwuError('列表中有不同扩展名的同名视频，会写入同一字幕；请先分别重命名。')
        outputOwners.add(output)
        const media = await inspectTingwuMedia(filePath)
        inspected.push({ filePath, ...media, key: language === 'cn' ? media.key : createHash('sha256').update(media.key + ':en').digest('hex') })
      }
      const client = createTingwuClient()
      const auth = await client.probe(signal)
      throwIfCancelled(signal)
      if (!auth.authenticated) throw new TingwuError(auth.message)
      const historyPath = path.join(app.getPath('userData'), 'tingwu-tasks.json')
      const history = await loadHistory(historyPath)
      for (let index = 0; index < inspected.length; index++) {
        throwIfCancelled(signal)
        const media = inspected[index]
        const output = expectedSrtPath(media.filePath)
        if (existsSync(output)) continue
        const progress = (message: string, percent?: number) => publish(getWindow, {
          status: 'running', message: `${index + 1}/${inspected.length} · ${path.basename(media.filePath)} · ${message}`, percent,
        })
        let task = history[media.key]
        if (task && (task.stage === 'creating' || task.stage === 'uploading')) {
          // An uncertain upload must not silently create a second cloud task.
          const status = task.transId ? await client.taskStatus(task.transId, signal) : null
          if (status !== null && [0, 1, 2, 3].includes(status)) {
            task.stage = 'transcribing'
            await saveHistory(historyPath, history)
          } else {
            throw new TingwuError(`上次上传未完成或结果不确定${task.transId ? `（任务 ${task.transId}）` : ''}。已停止重复提交；请在听悟网页检查，并由部署 Agent 核对本机 tingwu-tasks.json 中此条记录后恢复。`)
          }
        }
        if (!task) {
          progress('准备上传到听悟…')
          task = { localTaskId: `local-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            stage: 'creating', updatedAt: new Date().toISOString() }
          history[media.key] = task
          await saveHistory(historyPath, history)
          throwIfCancelled(signal)
          const upload = await client.generateUpload(media.filePath, media.size, media.contentType, task.localTaskId, signal, language)
          task.transId = upload.transId
          task.stage = 'uploading'
          await saveHistory(historyPath, history)
          await uploadTingwuMedia(media.filePath, media.size, media.contentType, upload, signal, progress)
          task.stage = 'syncing'
          await saveHistory(historyPath, history)
          await client.confirmUpload(upload, media.size, signal)
          task.stage = 'transcribing'
          task.updatedAt = new Date().toISOString()
          await saveHistory(historyPath, history)
        } else { progress('继续读取已有听悟任务，不重复上传…') }
        if (!task.transId) throw new TingwuError('听悟任务编号缺失，已停止重复提交。')
        const srt = await client.waitForSrt(task.transId, signal, progress)
        throwIfCancelled(signal)
        await writeSrtWithoutReplacing(output, srt)
        task.stage = 'completed'
        task.updatedAt = new Date().toISOString()
        await saveHistory(historyPath, history)
      }
      return finish({ success: true, message: `已为 ${pending.length} 个视频准备字幕。` }, 'completed')
    } catch (error) {
      if (signal.aborted) return finish({ success: false, cancelled: true,
        message: '已取消本地等待和后续上传；听悟云端已收到的任务仍保留。' }, 'cancelled')
      return finish({ success: false, message: error instanceof TingwuError ? error.message
        : '字幕任务失败，请检查文件读写权限、网络和听悟登录状态。',
        missingOutputs: pending.filter(filePath => !existsSync(expectedSrtPath(filePath))),
      }, 'failed')
    } finally { activeRun = null }
  })

  ipcMain.handle('asr-cancel', (event): boolean => {
    requirePlayer(event, getWindow)
    if (!activeRun) return false
    activeRun.abort()
    return true
  })
  app.on('before-quit', () => { activeRun?.abort(); disposeTingwuSession() })
}
