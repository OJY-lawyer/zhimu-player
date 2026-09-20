import { app, BrowserWindow, clipboard, dialog, ipcMain, screen } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import { chatGptTarget, normalizeChatGptSelection } from '../shared/guideGeneration'
import { CHATGPT_COOKIE_LIMITS, parseChatGptCookieImport, type CdpCookie } from './chatgptCookies'
import { applyChatGptCookies, ChatGptCookieImportError } from './chatgptCookieSession'
import { chatGptPageProbeExpression } from './chatgptAuth'
import { answerModelMatches, modelControlExpression, type WebModelControl } from './chatgptModelPage'
import { detectChatGptIntelligence, readChatGptIntelligenceModels, selectChatGptIntelligence } from './chatgptIntelligence'
import { chatGptComposerExpression, type ChatGptComposerState } from './chatgptComposer'
export { parseChatGptCookies } from './chatgptCookies'
import path from 'node:path'
import { EdgeCdp, connectEdge, parseEdgeEndpoint } from './edgeCdp'
import type {
  ChatGptGuideProgress,
  ChatGptGuideRequest,
  ChatGptGuideResult,
  ChatGptProbeResult,
  ChatGptModelsResult,
  ChatGptWebSelection,
} from '../shared/contracts'

type WindowProvider = () => BrowserWindow | null

function edgePath(): string {
  const candidates = [process.env.VIDEO_PLAYER_EDGE_PATH,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')]
  const found = candidates.find(p => p && path.isAbsolute(p) && existsSync(p))
  if (!found) throw new Error('没有找到 Microsoft Edge，请先安装 Edge 或在部署时指定其路径。')
  return found
}
const CHATGPT_URL = 'https://chatgpt.com/'
const PROJECT_NAME = '视频总结对话专用项目'
const INLINE_GUIDE_TASK_LIMIT = 120_000

type EdgeLaunchMode = 'headless' | 'background-window' | 'login-window'

let activeEdgeProcess: ChildProcess | null = null
let activeGuideCdp: EdgeCdp | null = null
let activeEdgeCdp: EdgeCdp | null = null
let edgeStartup: Promise<{ child: ChildProcess; cdp: EdgeCdp }> | null = null
let guideCancelled = false
let workerBusy = false
let generationBusy = false
let submitted = false

interface ChatGptProjectContext {
  projectId: string
  projectUrl: string
}

export function extractProjectIdFromResourceUrls(resourceUrls: string[]): string | null {
  for (const value of resourceUrls) {
    try {
      const pathname = new URL(value, CHATGPT_URL).pathname
      const match = pathname.match(/^\/backend-api\/gizmos\/(g-p-[^/]+)\/conversations\/?$/)
      if (match) return decodeURIComponent(match[1])
    } catch {
      continue
    }
  }
  return null
}

export function conversationBelongsToProject(
  conversation: { gizmo_id?: unknown; project_id?: unknown } | null | undefined,
  projectId: string,
): boolean {
  return conversation?.gizmo_id === projectId || conversation?.project_id === projectId
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) return
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('exit', () => resolve(true))),
    delay(timeoutMs).then(() => false),
  ])
  if (exited || child.exitCode !== null) return
  child.kill()
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    delay(3_000),
  ])
}

function loginWindowArgs(): string[] {
  const workArea = screen?.getPrimaryDisplay?.().workArea
  const width = Math.min(1100, workArea?.width || 1100)
  const height = Math.min(800, workArea?.height || 800)
  const x = workArea ? workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2)) : 80
  const y = workArea ? workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)) : 80
  return [`--window-position=${x},${y}`, `--window-size=${width},${height}`]
}

/** Account sign-in belongs to an ordinary browser window, outside the automated CDP session. */
export async function launchManualChatGptLogin(profileDirectory: string): Promise<ChatGptProbeResult> {
  await fs.mkdir(profileDirectory, { recursive: true })
  const executable = edgePath()
  return new Promise<ChatGptProbeResult>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(executable, [
        '--no-first-run', '--no-default-browser-check', '--new-window',
        `--user-data-dir=${profileDirectory}`, ...loginWindowArgs(), CHATGPT_URL,
      ], { windowsHide: false, detached: true, stdio: 'ignore' })
    } catch { reject(new Error('无法启动专用 Edge，请检查安装路径。')); return }
    child.once('error', () => reject(new Error('无法启动专用 Edge，请检查安装路径。')))
    child.once('spawn', () => {
      // Edge may hand this launch to another process and exit 0. Neither that exit nor opening
      // the browser proves sign-in. The user owns this window, including after the player exits.
      child.unref()
      resolve({ success: true, authenticated: false, authStatus: 'unknown', projectVisible: false,
        message: '已请求打开普通 Edge 登录窗口。完成登录后关闭这个专用窗口，再点击“检查连接”。' })
    })
  })
}

async function startEdge(
  profileDirectory: string,
  mode: EdgeLaunchMode = 'headless',
): Promise<{ child: ChildProcess; cdp: EdgeCdp }> {
  const pending = launchEdge(profileDirectory, mode)
  edgeStartup = pending
  try { return await pending } finally { if (edgeStartup === pending) edgeStartup = null }
}

async function launchEdge(
  profileDirectory: string,
  mode: EdgeLaunchMode = 'headless',
): Promise<{ child: ChildProcess; cdp: EdgeCdp }> {
  await fs.mkdir(profileDirectory, { recursive: true })
  const endpointFile = path.join(profileDirectory, 'DevToolsActivePort')
  // This file is generated connection metadata, not account data. Require a fresh launch endpoint.
  await fs.rm(endpointFile, { force: true })
  const modeArgs = mode === 'headless'
    ? ['--headless=new', 'about:blank']
    : mode === 'login-window' ? [...loginWindowArgs(), 'about:blank']
      : ['--window-position=-32000,-32000', '--window-size=1280,960', 'about:blank']
  const child = spawn(edgePath(), [
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    ...modeArgs,
  ], {
    windowsHide: mode !== 'login-window',
    stdio: 'ignore',
  })
  activeEdgeProcess = child
  let launchFailed = false
  child.once('error', () => { launchFailed = true })
  let cdp: EdgeCdp | null = null
  try {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      if (launchFailed || child.exitCode !== null && child.exitCode !== 0) throw new Error('无法启动专用 Edge，请检查安装路径。')
      let endpoint: string | null = null
      try { endpoint = parseEdgeEndpoint(await fs.readFile(endpointFile, 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取专用 Edge 的连接信息。') }
      if (endpoint) {
        try { cdp = await connectEdge(endpoint); break } catch { /* The endpoint can appear before the socket is listening. */ }
      }
      // On Windows the Edge launcher may exit successfully while another process starts the browser.
      // Readiness belongs to the live connection, not the launcher's exit status.
      await delay(100)
    }
    if (!cdp) throw new Error('Edge 启动后连接未就绪，请关闭播放器专用 Edge 窗口后重试。')
    await cdp.send('Browser.getVersion')
    if (guideCancelled) throw new Error('已取消浏览器连接。')
    activeEdgeCdp = cdp
    return { child, cdp }
  } catch (error) {
    await cdp?.close()
    if (child.exitCode === null) child.kill()
    await waitForExit(child, 3_000)
    activeEdgeProcess = null; activeEdgeCdp = null
    throw error
  }
}

async function openPage(cdp: EdgeCdp, url: string): Promise<string> {
  const target = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' })
  const attached = await cdp.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })
  await cdp.send('Page.enable', {}, attached.sessionId)
  const navigation = await cdp.send<{ errorText?: string }>('Page.navigate', { url }, attached.sessionId)
  if (navigation.errorText) throw new Error(navigation.errorText)

  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const state = await cdp.send<{
      result?: { value?: { readyState?: string } }
    }>('Runtime.evaluate', {
      expression: '({readyState: document.readyState})',
      returnByValue: true,
    }, attached.sessionId)
    if (state.result?.value?.readyState === 'complete') return attached.sessionId
    await delay(250)
  }
  throw new Error('Edge 页面加载超时')
}

async function navigatePage(cdp: EdgeCdp, sessionId: string, url: string): Promise<void> {
  const navigation = await cdp.send<{ errorText?: string }>('Page.navigate', { url }, sessionId)
  if (navigation.errorText) throw new Error(navigation.errorText)
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const state = await cdp.send<{
      result?: { value?: string }
    }>('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    }, sessionId)
    if (state.result?.value === 'complete') return
    await delay(250)
  }
  throw new Error('Edge 项目页面加载超时')
}

async function evaluateValue<T>(cdp: EdgeCdp, sessionId: string, expression: string): Promise<T> {
  const response = await cdp.send<{
    result?: { value?: T }
    exceptionDetails?: { text?: string; exception?: { description?: string } }
  }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
  if (response.exceptionDetails) {
    // Browser exception text can contain page data. Keep it outside renderer diagnostics.
    throw new Error('Edge 页面脚本执行失败，请稍后重试。')
  }
  return response.result?.value as T
}

async function waitForValue<T>(
  cdp: EdgeCdp,
  sessionId: string,
  expression: string,
  accept: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastValue: T
  while (Date.now() < deadline) {
    if (guideCancelled) throw new Error('ChatGPT 后台任务已取消')
    lastValue = await evaluateValue<T>(cdp, sessionId, expression)
    if (accept(lastValue)) return lastValue
    await delay(400)
  }
  throw new Error('等待 ChatGPT 页面响应超时')
}

async function inspectChatGptPage(cdp: EdgeCdp, sessionId: string): Promise<ChatGptProbeResult> {
  return evaluateValue<ChatGptProbeResult>(cdp, sessionId, chatGptPageProbeExpression(PROJECT_NAME))
}

async function waitForChatGptAuth(cdp: EdgeCdp, sessionId: string): Promise<ChatGptProbeResult> {
  const deadline = Date.now() + 20_000
  let result: ChatGptProbeResult
  do {
    if (guideCancelled) throw new Error('ChatGPT 后台任务已取消')
    result = await inspectChatGptPage(cdp, sessionId)
    if (result.blocked || result.authStatus === 'authenticated' || result.authStatus === 'signed-out') return result
    await delay(500)
  } while (Date.now() < deadline)
  return result
}

class GuidePageError extends Error {}

function requireChatGptAuth(connection: ChatGptProbeResult): void {
  if (connection.authStatus === 'authenticated') return
  if (connection.blocked) throw new GuidePageError(connection.message)
  if (connection.authStatus === 'signed-out') throw new GuidePageError('ChatGPT 尚未登录，请在设置中登录或导入 Cookie。')
  throw new GuidePageError('暂时无法确认 ChatGPT 登录状态，请稍后重试；无需立即重新登录。')
}

async function navigateToProject(cdp: EdgeCdp, sessionId: string, projectName: string): Promise<ChatGptProjectContext> {
  await waitForValue<boolean>(
    cdp,
    sessionId,
    `(() => {
      const wanted = ${JSON.stringify(projectName)};
      const candidates = [...document.querySelectorAll('span,a,button,div,p')];
      const label = candidates.find((candidate) => {
        if (!(candidate instanceof HTMLElement)) return false;
        const matches = [...candidate.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && (node.nodeValue || '').trim() === wanted
        );
        if (!matches) return false;
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const row = label?.closest('[role="button"][aria-controls]');
      if (!(row instanceof HTMLElement)) return false;
      if (row.getAttribute('aria-expanded') !== 'true') row.click();
      return true;
    })()`,
    Boolean,
    20_000,
  )

  await waitForValue<boolean>(
    cdp,
    sessionId,
    `(() => {
      const wanted = ${JSON.stringify(projectName)};
      const label = [...document.querySelectorAll('span,a,button,div,p')].find((candidate) => {
        if (!(candidate instanceof HTMLElement)) return false;
        return [...candidate.childNodes].some((node) =>
          node.nodeType === Node.TEXT_NODE && (node.nodeValue || '').trim() === wanted
        );
      });
      const row = label?.closest('[role="button"][aria-controls]');
      if (!(row instanceof HTMLElement)) return false;
      const controlled = document.getElementById(row.getAttribute('aria-controls') || '');
      const scopes = [controlled, row.parentElement, row].filter(Boolean);
      const home = scopes.flatMap((scope) => [...scope.querySelectorAll('button')]).find((button) => {
        const label = button.getAttribute('aria-label') || '';
        const rect = button.getBoundingClientRect();
        return /打开项目首页|open project home/i.test(label) && rect.width > 0 && rect.height > 0;
      });
      if (!(home instanceof HTMLElement)) return false;
      home.click();
      return true;
    })()`,
    Boolean,
    10_000,
  )

  let projectUrl = ''
  try {
    projectUrl = await waitForValue<string>(
      cdp,
      sessionId,
      `(() => {
        return /^\\/g\\/g-p-[^/]+\\/project\\/?$/.test(location.pathname) ? location.href : '';
      })()`,
      (value) => Boolean(value),
      25_000,
    )
  } catch {
    const state = await evaluateValue<{
      leftHome: boolean
      hasProjectName: boolean
      hasComposer: boolean
    }>(cdp, sessionId, `(() => {
        return {
          leftHome: location.href !== ${JSON.stringify(CHATGPT_URL)},
          hasProjectName: (document.body?.innerText || '').includes(${JSON.stringify(projectName)}),
          hasComposer: Boolean(document.querySelector('main #prompt-textarea, main textarea, main [contenteditable="true"]')),
        };
      })()`)
    throw new GuidePageError('项目入口已找到，但导航后页面未就绪：离开首页=' + state.leftHome
      + '，显示项目名=' + state.hasProjectName + '，显示输入框=' + state.hasComposer)
  }

  const initialProjectState = await waitForValue<{ ready: boolean; resourceUrls: string[] }>(
    cdp,
    sessionId,
    `(() => {
      const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name).filter((value) => {
        try { return /^\\/backend-api\\/gizmos\\/g-p-[^/]+\\/conversations\\/?$/.test(new URL(value).pathname); }
        catch { return false; }
      });
      const projectRoute = /^\\/g\\/g-p-[^/]+\\/project\\/?$/.test(location.pathname);
      const composer = document.querySelector('main #prompt-textarea, main textarea, main [contenteditable="true"]');
      return { ready: projectRoute && Boolean(composer) && resourceUrls.length > 0, resourceUrls };
    })()`,
    (value) => value.ready,
    30_000,
  )
  const projectId = extractProjectIdFromResourceUrls(initialProjectState.resourceUrls)
  if (!projectId) throw new GuidePageError('项目页面已经打开，但无法取得项目标识')
  await navigatePage(cdp, sessionId, projectUrl)
  await waitForValue<boolean>(
    cdp,
    sessionId,
    `(() => {
      const projectRoute = /^\\/g\\/g-p-[^/]+\\/project\\/?$/.test(location.pathname);
      const composer = document.querySelector('main #prompt-textarea, main textarea, main [contenteditable="true"]');
      return projectRoute && Boolean(composer);
    })()`,
    Boolean,
    30_000,
  )
  await delay(800)
  return { projectId, projectUrl }
}

async function dismissModelMenu(cdp: EdgeCdp, sessionId: string): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId)
}

async function selectGuideModel(cdp: EdgeCdp, sessionId: string, selection: ChatGptWebSelection, modelOnly = false): Promise<void> {
  if (!modelOnly && await detectChatGptIntelligence(cdp, sessionId)) {
    if (await selectChatGptIntelligence(cdp, sessionId, selection)) return
    throw new GuidePageError('无法确认所选网页模型或推理档位。请刷新网页选项或在登录窗口核对；未发送字幕。')
  }
  for (const kind of ['model', 'reasoning'] as const) {
    if (kind === 'reasoning' && modelOnly) continue
    const inspect = (action: 'read' | 'open' | 'choose' | 'check') => modelControlExpression(kind, action, selection)
    if ((await evaluateValue<WebModelControl>(cdp, sessionId, inspect('check'))).matched) continue
    await dismissModelMenu(cdp, sessionId)
    const opened = await evaluateValue<WebModelControl>(cdp, sessionId, inspect('open'))
    if (opened.available) {
      await delay(350)
      await evaluateValue(cdp, sessionId, inspect('choose'))
      const deadline = Date.now() + 5000
      do {
        await delay(250)
        if ((await evaluateValue<WebModelControl>(cdp, sessionId, inspect('check'))).matched) break
      } while (Date.now() < deadline)
    }
    if (!(await evaluateValue<WebModelControl>(cdp, sessionId, inspect('check'))).matched) {
      throw new GuidePageError('无法确认所选网页模型或推理档位。请刷新网页选项或在登录窗口核对；未发送字幕。')
    }
  }
  await dismissModelMenu(cdp, sessionId)
}

export async function listChatGptModels(profileDirectory: string): Promise<ChatGptModelsResult> {
  const { child, cdp } = await startEdge(profileDirectory, 'background-window')
  try {
    const sessionId = await openPage(cdp, CHATGPT_URL)
    requireChatGptAuth(await waitForChatGptAuth(cdp, sessionId))
    if (await detectChatGptIntelligence(cdp, sessionId)) {
      const models = await readChatGptIntelligenceModels(cdp, sessionId)
      return { success: models.length > 0, models, message: models.length
        ? '已读取当前网页可用选项。请选择模型和推理档位；生成前会再次确认。'
        : '当前网页菜单无法可靠读取，请打开登录窗口核对；已有选择已保留。' }
    }
    const placeholder: ChatGptWebSelection = { model: '', reasoning: null }
    const read = (kind: 'model' | 'reasoning', action: 'read' | 'open', selection = placeholder) =>
      evaluateValue<WebModelControl>(cdp, sessionId, modelControlExpression(kind, action, selection))
    const initialModel = await read('model', 'read')
    const initialEffort = await read('reasoning', 'read')
    if (!initialModel.available) throw new GuidePageError('没有找到网页模型菜单，请打开登录窗口核对当前页面。')
    await read('model', 'open')
    await delay(400)
    const menu = await read('model', 'read')
    await dismissModelMenu(cdp, sessionId)
    const models: ChatGptModelsResult['models'] = []
    try {
      for (const model of menu.options.slice(0, 30)) {
        // A mode-only menu does not identify its model family. Presets remain available
        // for those layouts; do not publish an ambiguous name as a verified model.
        if (/^(instant|thinking|即时|思考)$/i.test(model)) continue
        if (guideCancelled) throw new GuidePageError('ChatGPT 后台任务已取消')
        const selection = { model, reasoning: null }
        try { await selectGuideModel(cdp, sessionId, selection, true) } catch (error) {
          if (error instanceof GuidePageError) continue
          throw error
        }
        await delay(300)
        const effortControl = await read('reasoning', 'read', selection)
        let reasoningOptions: string[] = []
        if (effortControl.available) {
          await read('reasoning', 'open', selection)
          await delay(250)
          reasoningOptions = (await read('reasoning', 'read', selection)).options
          await dismissModelMenu(cdp, sessionId)
          // A selector with an unreadable menu is not evidence of a model without effort settings.
          if (!reasoningOptions.length) continue
        }
        models.push({ model, reasoningOptions })
      }
    } finally {
      await dismissModelMenu(cdp, sessionId).catch(() => {})
      if (initialModel.label) {
        await selectGuideModel(cdp, sessionId, { model: initialModel.label, reasoning: initialEffort.label }).catch(() => {})
      }
    }
    return { success: models.length > 0, models, message: models.length
      ? '已读取当前网页可用选项。请选择模型和推理档位；生成前会再次确认。'
      : '当前网页菜单无法可靠读取，请打开登录窗口核对；已有选择已保留。' }
  } finally {
    await cdp.close()
    await waitForExit(child, 3000)
    activeEdgeProcess = null; activeEdgeCdp = null
  }
}

async function setFileInput(cdp: EdgeCdp, sessionId: string, filePath: string): Promise<void> {
  await cdp.send('DOM.enable', {}, sessionId)
  let root = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
  let input = await cdp.send<{ nodeId: number }>('DOM.querySelector', {
    nodeId: root.root.nodeId,
    selector: 'form input[type="file"][multiple], form input[type="file"]',
  }, sessionId)

  if (!input.nodeId) {
    const clicked = await evaluateValue<boolean>(cdp, sessionId, `(() => {
      const controls = [...document.querySelectorAll('button,[role="button"]')];
      const node = controls.find((item) => {
        const value = ((item.getAttribute('aria-label') || '') + ' ' + (item.getAttribute('title') || '') + ' ' + (item.textContent || '')).toLowerCase();
        return /attach|upload|add file|附件|上传|添加文件/.test(value);
      });
      if (!node) return false;
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    })()`)
    if (!clicked) throw new GuidePageError('没有找到 ChatGPT 附件按钮')
    await delay(500)
    root = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
    input = await cdp.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: 'form input[type="file"][multiple], form input[type="file"]',
    }, sessionId)
  }
  if (!input.nodeId) throw new GuidePageError('没有找到 ChatGPT 文件上传控件')
  await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [filePath] }, sessionId)
}

async function waitForAttachedFile(cdp: EdgeCdp, sessionId: string, fileName: string): Promise<void> {
  await waitForValue<boolean>(
    cdp,
    sessionId,
    `(() => {
      const composer = document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
      const scope = composer?.closest('form') || composer?.parentElement?.parentElement;
      return Boolean(scope && (scope.textContent || '').includes(${JSON.stringify(fileName)}));
    })()`,
    Boolean,
    25_000,
  )
  await waitForValue<boolean>(
    cdp,
    sessionId,
    `(() => {
      const removeButton = [...document.querySelectorAll('button')].some((button) =>
        /移除文件|remove file/i.test(button.getAttribute('aria-label') || '')
        && (button.getAttribute('aria-label') || '').includes(${JSON.stringify(fileName)})
      );
      const rawUploaded = performance.getEntriesByType('resource').some((entry) => {
        try {
          const url = new URL(entry.name);
          const status = Number(entry.responseStatus || 0);
          return /oaiusercontent/i.test(url.hostname) && url.pathname.includes('/raw') && status >= 200 && status < 300;
        } catch { return false; }
      });
      return removeButton && rawUploaded;
    })()`,
    Boolean,
    45_000,
  )
}

async function submitGuideTask(cdp: EdgeCdp, sessionId: string, promptText: string): Promise<string> {
  const initial = await evaluateValue<ChatGptComposerState>(cdp, sessionId, chatGptComposerExpression('read', promptText))
  if (!initial.found) throw new GuidePageError('没有找到 ChatGPT 输入框')
  if (!initial.empty) throw new GuidePageError('ChatGPT 输入框已有内容，已保留草稿并停止发送。请在专用窗口检查。')
  await evaluateValue<ChatGptComposerState>(cdp, sessionId, chatGptComposerExpression('paste', promptText))
  try {
    await waitForValue<ChatGptComposerState>(cdp, sessionId, chatGptComposerExpression('read', promptText), state => state.found && state.matches, 5_000)
  } catch {
    throw new GuidePageError('字幕任务未完整写入 ChatGPT，已停止发送。请稍后重试。')
  }
  await waitForValue<boolean>(cdp, sessionId, `(() => {
    const controls = [...document.querySelectorAll('button')];
    const button = document.querySelector('[data-testid="send-button"]')
      || controls.find((item) => /^(send|发送)$/i.test((item.getAttribute('aria-label') || item.textContent || '').trim()))
      || controls.find((item) => item.getAttribute('type') === 'submit' && !item.hasAttribute('disabled'));
    return Boolean(button instanceof HTMLElement && !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true');
  })()`, Boolean, 30_000)
  const verified = await evaluateValue<ChatGptComposerState>(cdp, sessionId, chatGptComposerExpression('read', promptText))
  if (!verified.matches) throw new GuidePageError('字幕任务未完整写入 ChatGPT，已停止发送。请稍后重试。')
  submitted = true // An interrupted click may already have submitted; never retry automatically after this point.
  const sent = await evaluateValue<boolean>(cdp, sessionId, `(() => {
    const button = document.querySelector('[data-testid="send-button"]');
    if (!(button instanceof HTMLElement) || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    return true;
  })()`)
  if (!sent) throw new GuidePageError('ChatGPT 附件已经就绪，但发送按钮不可用')
  await waitForValue<boolean>(
    cdp,
    sessionId,
    `(() => location.pathname.includes('/c/'))()`,
    Boolean,
    20_000,
  )
  const conversationId = await evaluateValue<string>(
    cdp,
    sessionId,
    `(() => (location.pathname.split('/c/')[1] || '').split('/')[0])()`,
  )
  if (!conversationId) throw new GuidePageError('对话已经发送，但无法取得对话标识')
  return conversationId
}

async function waitForGuideAnswer(
  cdp: EdgeCdp,
  sessionId: string,
  conversationId: string,
  projectId: string | null,
  selection: ChatGptWebSelection,
): Promise<string> {
  const deadline = Date.now() + 30 * 60_000
  let committedConversationId: string | null = null
  while (Date.now() < deadline) {
    if (guideCancelled) throw new GuidePageError('ChatGPT 后台任务已取消')
    const state: {
      content: string
      finished: boolean
      loaded: boolean
      gizmoId: string | null
      projectId: string | null
      model: string
      effort: string | null
      conversationId: string
      failure?: 'auth-required' | 'access-denied' | 'rate-limit' | 'conversation-changed'
    } = await evaluateValue(cdp, sessionId, `(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const pending = { content: '', finished: false, loaded: false };
      try {
        const route = location.pathname.match(/\\/c\\/([a-zA-Z0-9-]{1,100})(?:\\/|$)/);
        const id = route?.[1] || ${JSON.stringify(conversationId)};
        const committed = ${JSON.stringify(committedConversationId)};
        if (location.origin !== 'https://chatgpt.com' || committed && id !== committed) return { ...pending, failure: 'conversation-changed' };
        const authResponse = await fetch('/api/auth/session', { credentials: 'include', signal: controller.signal });
        if (authResponse.status === 401) return { ...pending, failure: 'auth-required' };
        if (authResponse.status === 403) return { ...pending, failure: 'access-denied' };
        const auth = authResponse.ok ? await authResponse.json() : null;
        if (!auth?.accessToken) return pending;
        // Chat initially uses an optimistic local ID and replaces it with the saved ID.
        // Follow that replacement until the server has actually returned this conversation.
        const response = await fetch('/backend-api/conversation/' + id, {
          credentials: 'include',
          signal: controller.signal,
          headers: { Authorization: 'Bearer ' + auth.accessToken },
        });
        if (response.status === 401) return { ...pending, failure: 'auth-required' };
        if (response.status === 403) return { ...pending, failure: 'access-denied' };
        if (response.status === 429) return { ...pending, failure: 'rate-limit' };
        const detail = response.ok ? await response.json() : null;
        const entries = [];
        let node = detail?.mapping?.[detail?.current_node];
        const visited = new Set();
        while (node && !visited.has(node.id)) { visited.add(node.id); entries.push(node); node = detail.mapping[node.parent]; }
        const assistant = entries.map((entry) => entry?.message).filter((message) =>
          message?.author?.role === 'assistant' && message?.metadata?.is_visually_hidden_from_conversation !== true && (!message?.channel || message.channel === 'final')
        ).sort((left, right) => Number(left?.create_time || 0) - Number(right?.create_time || 0));
        const message = assistant[assistant.length - 1] || null;
        const content = Array.isArray(message?.content?.parts)
          ? message.content.parts.filter((part) => typeof part === 'string').join(String.fromCharCode(10)).trim()
          : '';
        const status = String(message?.status || '').toLowerCase();
        return {
          content,
          finished: message?.end_turn === true && status === 'finished_successfully',
          loaded: Boolean(detail),
          conversationId: id,
          model: typeof message?.metadata?.model_slug === 'string' ? message.metadata.model_slug : '',
          effort: typeof message?.metadata?.reasoning_effort === 'string' ? message.metadata.reasoning_effort : null,
          gizmoId: typeof detail?.gizmo_id === 'string' ? detail.gizmo_id : null,
          projectId: typeof detail?.project_id === 'string' ? detail.project_id : null,
        };
      } catch { return pending; }
      finally { clearTimeout(timer); controller.abort(); }
    })()`)
    if (state.failure === 'access-denied') throw new GuidePageError('ChatGPT 拒绝读取已提交对话（403）。请在专用登录窗口按网页提示处理；不要重复提交。')
    if (state.failure === 'auth-required') throw new GuidePageError('读取导读时登录已失效。请在专用窗口查看已提交的对话。')
    if (state.failure === 'rate-limit') throw new GuidePageError('ChatGPT 暂时限制了读取频率。请稍后在专用窗口查看已提交的对话。')
    if (state.failure === 'conversation-changed') throw new GuidePageError('生成期间网页切换到了其他对话，已停止读取。请在专用窗口查看原对话。')
    if (state.loaded) committedConversationId = state.conversationId
    if (projectId && state.loaded && !conversationBelongsToProject({ gizmo_id: state.gizmoId, project_id: state.projectId }, projectId)) {
      throw new GuidePageError(`新建对话未归属“${PROJECT_NAME}”，本次导读未保存`)
    }
    if (state.finished && state.content.trim()) {
      if (!answerModelMatches(selection, state.model, state.effort)) {
        throw new GuidePageError('本次回复的模型与所选设置不符，或网页未提供可核验的模型信息，导读未保存。请在 ChatGPT 中核对这次对话。')
      }
      return state.content
    }
    await delay(8_000)
  }
  throw new GuidePageError('等待 ChatGPT 完成导读超时')
}

async function runGuideAttempt(
  profileDirectory: string,
  taskPath: string,
  emit: (progress: ChatGptGuideProgress) => void,
  attempt: number,
  request: ChatGptGuideRequest,
): Promise<string> {
  const { child, cdp } = await startEdge(profileDirectory, 'background-window')
  activeGuideCdp = cdp
  try {
    emit({ status: 'running', stage: 'opening-project', message: request.projectName ? '正在进入指定项目' : '正在打开新的 ChatGPT 对话', attempt })
    const sessionId = await openPage(cdp, CHATGPT_URL)
    requireChatGptAuth(await waitForChatGptAuth(cdp, sessionId))
    const project = request.projectName?.trim() ? await navigateToProject(cdp, sessionId, request.projectName.trim()) : null
    const selection = normalizeChatGptSelection(request.selection)
    if (!selection) throw new GuidePageError('请先在设置中选择 ChatGPT 网页模型和推理档位。')
    const target = chatGptTarget(selection)

    emit({ status: 'running', stage: 'selecting-model', message: '正在确认 ' + target.label, attempt })
    await selectGuideModel(cdp, sessionId, selection)

    const taskMarkdown = await fs.readFile(taskPath, 'utf8')
    let promptText = ''
    if (taskMarkdown.length <= INLINE_GUIDE_TASK_LIMIT) {
      emit({ status: 'running', stage: 'uploading', message: '正在写入字幕任务', attempt })
      promptText = '请根据下面的完整任务生成内容导读。严格遵循其中的全部规则；最终 Markdown 正文放在一个 markdown 代码块中，代码块外不要写任何文字。\n\n' + taskMarkdown
    } else {
      emit({ status: 'running', stage: 'uploading', message: '正在上传字幕任务文本', attempt })
      await setFileInput(cdp, sessionId, taskPath)
      await waitForAttachedFile(cdp, sessionId, path.basename(taskPath))
      promptText = '请读取附件并生成内容导读。严格遵循附件中的全部规则；最终 Markdown 正文放在一个 markdown 代码块中，代码块外不要写任何文字。'
    }
    await selectGuideModel(cdp, sessionId, selection)
    const conversationId = await submitGuideTask(cdp, sessionId, promptText)

    emit({ status: 'running', stage: 'waiting', message: target.label + ' 正在生成导读', attempt })
    return await waitForGuideAnswer(cdp, sessionId, conversationId, project?.projectId || null, selection)
  } finally {
    activeGuideCdp = null
    await cdp.close()
    await waitForExit(child, 3_000)
    activeEdgeProcess = null; activeEdgeCdp = null
  }
}

export async function probeEdgeUrl(profileDirectory: string, url: string, mode: EdgeLaunchMode = 'headless'): Promise<{ title: string; url: string }> {
  if (activeEdgeProcess) throw new Error('Edge 后台任务正在运行')
  const { child, cdp } = await startEdge(profileDirectory, mode)
  try {
    const sessionId = await openPage(cdp, url)
    return await evaluateValue(cdp, sessionId, '({title: document.title, url: location.href})')
  } finally {
    await cdp.close()
    await waitForExit(child, 3_000)
    activeEdgeProcess = null; activeEdgeCdp = null
  }
}

export async function probeChatGpt(profileDirectory: string, cookies: CdpCookie[] = []): Promise<ChatGptProbeResult> {
  if (activeEdgeProcess) return { success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message: 'Edge 后台任务正在运行。' }
  const { child, cdp } = await startEdge(profileDirectory, 'background-window')
  try {
    const sessionId = await openPage(cdp, 'about:blank')
    if (cookies.length) {
      await applyChatGptCookies({ send: (method, params) => cdp.send(method, params, sessionId) }, cookies)
    }
    await navigatePage(cdp, sessionId, CHATGPT_URL)
    return await waitForChatGptAuth(cdp, sessionId)
  } finally {
    await cdp.close()
    await waitForExit(child, 3_000)
    activeEdgeProcess = null; activeEdgeCdp = null
  }
}

export async function shutdownChatGptBrowser(): Promise<void> {
  guideCancelled = true
  try { await edgeStartup } catch { /* Cancelled startup closes any connection it established. */ }
  await activeEdgeCdp?.close()
  if (activeEdgeProcess?.exitCode === null) await waitForExit(activeEdgeProcess, 3000)
}

function connectionFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  // Only application-defined diagnostics are shown; never pass browser payloads or file paths through.
  const known = [
    '没有找到 Microsoft Edge，请先安装 Edge 或在部署时指定其路径。',
    '无法启动专用 Edge，请检查安装路径。', '无法读取专用 Edge 的连接信息。',
    'Edge 启动后连接未就绪，请关闭播放器专用 Edge 窗口后重试。',
    '专用 Edge 窗口已关闭，请重新打开登录窗口。', '专用 Edge 连接中断，请重新打开登录窗口。',
    '专用 Edge 尚未连接。', '专用 Edge 连接超时。', '已取消浏览器连接。',
    'Edge 页面加载超时', 'Edge 项目页面加载超时', 'Edge 页面脚本执行失败，请稍后重试。',
  ]
  if (known.includes(message)) return message
  if (/^net::ERR_[A-Z_]+$/.test(message)) return 'ChatGPT 页面暂时无法打开，请检查网络后重新打开登录窗口。'
  return '专用浏览器连接失败，请检查 Edge 与网络后重试。'
}

export function registerChatGptEdgeWorker(getWindow: WindowProvider): void {
  const profileDirectory = () => path.join(app.getPath('userData'), 'chatgpt-edge-profile')
  const emit = (progress: ChatGptGuideProgress) => { const w = getWindow(); if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('chatgpt-guide-progress', progress) }
  const handle = (channel: string, action: (...args: any[]) => Promise<any>) => ipcMain.handle(channel, async (...args) => {
    if (workerBusy) return { success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message: '专用浏览器正在工作，请完成或关闭登录窗口后重试。' }
    workerBusy = true; guideCancelled = false
    try { return await action(...args) }
    catch (error) { return { success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message: connectionFailureMessage(error) } }
    finally { workerBusy = false }
  })
  handle('chatgpt-login', async (): Promise<ChatGptProbeResult> => {
    return launchManualChatGptLogin(profileDirectory())
  })
  handle('chatgpt-logout', async (): Promise<ChatGptProbeResult> => {
    const { child, cdp } = await startEdge(profileDirectory(), 'background-window')
    try { await cdp.send('Storage.clearCookies') }
    finally { await cdp.close(); await waitForExit(child, 3000); activeEdgeProcess = null; activeEdgeCdp = null }
    return { success: true, authenticated: false, authStatus: 'signed-out', projectVisible: false, message: '已清除播放器专用 ChatGPT 登录态。' }
  })

  handle('chatgpt-import-cookies', async (_event, source: unknown = 'clipboard', pastedText?: unknown): Promise<ChatGptProbeResult> => {
    const failed = (message: string): ChatGptProbeResult => ({ success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message })
    if (source !== 'clipboard' && source !== 'file' && source !== 'paste') return failed('请选择文件、剪贴板或粘贴 JSON 导入。')
    let raw = ''
    if (source === 'file') {
      const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Cookie-Editor JSON', extensions: ['json', 'txt'] }] }
      const window = getWindow()
      const selected = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (selected.canceled || selected.filePaths.length !== 1) return failed('已取消导入，原有登录资料未更改。')
      try {
        const stat = await fs.stat(selected.filePaths[0])
        if (!stat.isFile() || stat.size > CHATGPT_COOKIE_LIMITS.inputBytes) return failed('Cookie 导出文件过大，请只导出 ChatGPT 网站的 Cookie。')
        raw = await fs.readFile(selected.filePaths[0], 'utf8')
      } catch { return failed('无法读取所选 Cookie 文件，请重新选择。') }
    } else if (source === 'paste') {
      if (typeof pastedText !== 'string') return failed('请粘贴 Cookie-Editor 导出的 JSON。')
      raw = pastedText
    } else raw = await clipboard.readText()
    let imported: ReturnType<typeof parseChatGptCookieImport>
    try { imported = parseChatGptCookieImport(raw) }
    catch (error) { return failed(error instanceof Error ? error.message : 'Cookie 导出内容无法识别，请重新导出。') }
    if (!imported.cookies.length) return failed('没有找到可导入的 ChatGPT Cookie，请从已登录的 ChatGPT 页面重新导出。')
    try {
      const result = await probeChatGpt(profileDirectory(), imported.cookies)
      if (source === 'clipboard' && await clipboard.readText() === raw) await clipboard.clear()
      return { ...result, message: '已导入 ' + imported.cookies.length + ' 条 ChatGPT Cookie。' + result.message }
    } catch (error) { return failed(error instanceof ChatGptCookieImportError ? error.message : '导入或检查连接未完成。请关闭专用登录窗口、检查网络后重试；原浏览器不受影响。') }
  })

  handle('chatgpt-probe', async (): Promise<ChatGptProbeResult> => probeChatGpt(profileDirectory()))
  handle('chatgpt-models', async (): Promise<ChatGptModelsResult> => {
    try { return await listChatGptModels(profileDirectory()) }
    catch (error) { return { success: false, models: [], message: error instanceof GuidePageError ? error.message : connectionFailureMessage(error) } }
  })

  handle('chatgpt-generate-guide', async (_event, request: ChatGptGuideRequest): Promise<ChatGptGuideResult> => {
    if (activeEdgeProcess) return { success: false, message: 'Edge 后台任务正在运行。' }
    if (typeof request?.taskMarkdown !== 'string' || !request.taskMarkdown.trim() || request.taskMarkdown.length > 8_000_000) return { success: false, message: '导读任务内容为空。' }
    if (!normalizeChatGptSelection(request?.selection)) return { success: false, message: '请先在设置中选择 ChatGPT 网页模型和推理档位。' }

    guideCancelled = false
    generationBusy = true
    submitted = false
    let taskDirectory = ''
    let lastError = 'ChatGPT 固定脚本运行失败。'
    try {
      taskDirectory = await fs.mkdtemp(path.join(app.getPath('temp'), 'video-player-guide-'))
      const safeName = (typeof request.playlistName === 'string' ? request.playlistName : '视频').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || '视频'
      const taskPath = path.join(taskDirectory, safeName + '.导读任务.txt')
      await fs.writeFile(taskPath, request.taskMarkdown, 'utf8')
      if (guideCancelled) return { success: false, cancelled: true, message: '已取消导读任务。' }
      emit({ status: 'running', stage: 'preparing', message: '正在准备字幕任务', attempt: 1 })
      for (let attempt = 1; attempt <= 1; attempt += 1) {
        try {
          const content = await runGuideAttempt(profileDirectory(), taskPath, emit, attempt, request)
          emit({ status: 'completed', stage: 'completed', message: 'ChatGPT 导读已经生成', attempt })
          return { success: true, message: 'ChatGPT 导读已经生成。', content }
        } catch (error) {
          if (guideCancelled) {
            emit({ status: 'cancelled', stage: 'completed', message: '已取消 ChatGPT 导读任务', attempt })
            return { success: false, cancelled: true, message: 'ChatGPT 导读任务已取消。' }
          }
          lastError = error instanceof GuidePageError ? error.message : connectionFailureMessage(error)
          if (/登录态|人机验证/.test(lastError)) break
        }
      }
      const message = lastError + (submitted ? ' 本次可能已提交，请先在专用窗口核对后再手动重试。' : '')
      emit({ status: 'failed', stage: 'completed', message })
      return { success: false, message }
    } finally {
      guideCancelled = false
      generationBusy = false
      if (taskDirectory) await fs.rm(taskDirectory, { recursive: true, force: true })
    }
  })

  ipcMain.handle('chatgpt-cancel-guide', async (): Promise<boolean> => {
    if (!generationBusy) return false
    guideCancelled = true
    await activeGuideCdp?.close()
    return true
  })

  let browserQuitPending = false
  app.on('before-quit', (event) => {
    guideCancelled = true
    if ((edgeStartup || activeEdgeCdp && !activeEdgeCdp.isClosed) && !browserQuitPending) {
      browserQuitPending = true
      event.preventDefault()
      void shutdownChatGptBrowser().finally(() => app.quit())
    } else if (activeEdgeProcess?.exitCode === null) activeEdgeProcess.kill()
  })
}
