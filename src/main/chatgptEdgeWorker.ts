import { app, BrowserWindow, clipboard, ipcMain, screen } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import { chatGptModelPolicy, chatGptTarget } from '../shared/guideGeneration'
import type { ChatGptTier } from '../shared/contracts'
import path from 'node:path'
import { EdgeCdp, connectEdge, parseEdgeEndpoint } from './edgeCdp'
import type {
  ChatGptGuideProgress,
  ChatGptGuideRequest,
  ChatGptGuideResult,
  ChatGptProbeResult,
} from '../shared/contracts'

type WindowProvider = () => BrowserWindow | null

interface CookieEditorCookie {
  name?: unknown
  value?: unknown
  domain?: unknown
  path?: unknown
  secure?: unknown
  httpOnly?: unknown
  sameSite?: unknown
  expirationDate?: unknown
  session?: unknown
}

interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
  expires?: number
}

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

function normalizeSameSite(value: unknown): CdpCookie['sameSite'] {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'strict') return 'Strict'
  if (normalized === 'lax') return 'Lax'
  if (normalized === 'none' || normalized === 'no_restriction') return 'None'
  return undefined
}

export function parseChatGptCookies(raw: string): CdpCookie[] {
  const parsed = JSON.parse(raw) as unknown
  const source = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { cookies?: unknown }).cookies)
      ? (parsed as { cookies: unknown[] }).cookies
      : []

  return source.flatMap((entry) => {
    const cookie = entry as CookieEditorCookie
    const domain = typeof cookie.domain === 'string' ? cookie.domain.toLowerCase() : ''
    const bareDomain = domain.replace(/^\./, '')
    if (!cookie.name || typeof cookie.value !== 'string') return []
    if (bareDomain !== 'chatgpt.com' && !bareDomain.endsWith('.chatgpt.com')) return []

    const normalized: CdpCookie = {
      name: String(cookie.name),
      value: cookie.value,
      domain,
      path: typeof cookie.path === 'string' ? cookie.path : '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
    }
    const sameSite = normalizeSameSite(cookie.sameSite)
    if (sameSite) normalized.sameSite = sameSite
    if (!cookie.session && typeof cookie.expirationDate === 'number') {
      normalized.expires = cookie.expirationDate
    }
    return [normalized]
  })
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
      resolve({ success: true, authenticated: false, projectVisible: false,
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
    const detail = response.exceptionDetails.exception?.description || response.exceptionDetails.text || ''
    throw new Error('Edge 页面脚本执行失败' + (detail ? '：' + detail.slice(0, 400) : ''))
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
  return evaluateValue<ChatGptProbeResult>(cdp, sessionId, `(async () => {
    const text = document.body?.innerText || '';
    let sessionUser = false;
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      const session = response.ok ? await response.json() : null;
      sessionUser = Boolean(session?.user);
    } catch {}
    const projectVisible = text.includes(${JSON.stringify(PROJECT_NAME)});
    const blocked = /verify you are human|just a moment|cloudflare|验证您是真人|安全验证/i.test(document.title + ' ' + text.slice(0, 800));
    const hasLoginAction = [...document.querySelectorAll('a,button')].some((node) =>
      /^(log in|sign up|登录|注册)$/i.test((node.textContent || '').trim())
    );
    const authenticated = sessionUser;
    return {
      success: authenticated && !blocked,
      authenticated: authenticated && !blocked,
      projectVisible,
      blocked,
      currentUrl: location.href,
      message: blocked
        ? 'ChatGPT 要求进行人机验证。'
        : authenticated
          ? 'ChatGPT 登录成功。模型与思考档位会在生成前核验。'
          : 'ChatGPT 登录态无效或已经过期。'
    };
  })()`)
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
    throw new Error('项目入口已找到，但导航后页面未就绪：离开首页=' + state.leftHome
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
  if (!projectId) throw new Error('项目页面已经打开，但无法取得项目标识')
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

async function selectGuideModel(cdp: EdgeCdp, sessionId: string, tier: ChatGptTier): Promise<void> {
  const target = chatGptTarget(tier)
  const policy = chatGptModelPolicy(tier)
  // Only selected controls count as evidence, never mentions in chat or the sidebar.
  const inspect = (kind: 'model' | 'effort', action: 'check' | 'open' | 'pick') => `(() => {
    const kind = ${JSON.stringify(kind)}, action = ${JSON.stringify(action)};
    const matcher = new RegExp(${JSON.stringify(policy[kind])}, 'i');
    const visible = n => n instanceof HTMLElement && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0;
    const label = n => ((n.textContent || '') + ' ' + (n.getAttribute('aria-label') || '')).trim();
    const active = n => n.getAttribute('aria-checked') === 'true' || n.getAttribute('aria-selected') === 'true' || n.getAttribute('aria-pressed') === 'true';
    const nodes = [...document.querySelectorAll('button,[role="menuitemradio"],[role="menuitem"],[role="option"]')].filter(visible);
    // Some web layouts expose a combined selected “Astra Pro” model instead of
    // a separate effort button. Require that exact label on the model control.
    if (action === 'check' && kind === 'effort' && ${JSON.stringify(tier === 'pro')}) {
      const combined = nodes.some(n => n.tagName === 'BUTTON' && n.getAttribute('aria-haspopup') &&
        (/model-switcher/i.test(n.getAttribute('data-testid') || '') || /model|模型/i.test(n.getAttribute('aria-label') || '')) &&
        /astra\\s*(?:[·/—-]\\s*)?pro\\b/i.test((n.textContent || '').trim()));
      if (combined) return true;
    }
    if (action === 'check') return nodes.some(n => matcher.test((n.textContent || '').trim()) && (active(n) || (n.tagName === 'BUTTON' && n.getAttribute('aria-haspopup') && (kind === 'model' ? /model-switcher/i.test(n.getAttribute('data-testid') || '') || /model|模型/i.test(n.getAttribute('aria-label') || '') : /reason|think|思考/i.test(label(n)) || n.closest('main,form')))));
    if (action === 'pick') {
      const n = nodes.find(n => matcher.test((n.textContent || '').trim()) && /menuitem|option/.test(n.getAttribute('role') || ''));
      if (!n) return false; n.click(); return true;
    }
    const n = nodes.find(n => n.tagName === 'BUTTON' && n.getAttribute('aria-haspopup') && (kind === 'model' ? /model-switcher/i.test(n.getAttribute('data-testid') || '') || /model|模型/i.test(label(n)) : /reason|think|思考|standard|extended|heavy|light|极高|pro/i.test(label(n)) && n.closest('main,form')));
    if (!n) return false; n.click(); return true;
  })()`
  for (const kind of ['model', 'effort'] as const) {
    if (await evaluateValue<boolean>(cdp, sessionId, inspect(kind, 'check'))) continue
    await evaluateValue(cdp, sessionId, inspect(kind, 'open'))
    await delay(500)
    await evaluateValue(cdp, sessionId, inspect(kind, 'pick'))
    await delay(500)
    if (!await evaluateValue<boolean>(cdp, sessionId, inspect(kind, 'check'))) {
      throw new Error('无法确认 ' + target.model + ' · ' + target.effort + '。请打开专用登录窗口核对账号可用模型和档位；未发送字幕。')
    }
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
    if (!clicked) throw new Error('没有找到 ChatGPT 附件按钮')
    await delay(500)
    root = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: -1, pierce: true }, sessionId)
    input = await cdp.send<{ nodeId: number }>('DOM.querySelector', {
      nodeId: root.root.nodeId,
      selector: 'form input[type="file"][multiple], form input[type="file"]',
    }, sessionId)
  }
  if (!input.nodeId) throw new Error('没有找到 ChatGPT 文件上传控件')
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
  const focused = await evaluateValue<boolean>(cdp, sessionId, `(() => {
    const composer = document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
    if (!(composer instanceof HTMLElement)) return false;
    composer.focus();
    return true;
  })()`)
  if (!focused) throw new Error('没有找到 ChatGPT 输入框')
  await cdp.send('Input.insertText', {
    text: promptText,
  }, sessionId)
  await waitForValue<boolean>(cdp, sessionId, `(() => {
    const controls = [...document.querySelectorAll('button')];
    const button = document.querySelector('[data-testid="send-button"]')
      || controls.find((item) => /^(send|发送)$/i.test((item.getAttribute('aria-label') || item.textContent || '').trim()))
      || controls.find((item) => item.getAttribute('type') === 'submit' && !item.hasAttribute('disabled'));
    return Boolean(button instanceof HTMLElement && !button.hasAttribute('disabled') && button.getAttribute('aria-disabled') !== 'true');
  })()`, Boolean, 30_000)
  const sent = await evaluateValue<boolean>(cdp, sessionId, `(() => {
    const button = document.querySelector('[data-testid="send-button"]');
    if (!(button instanceof HTMLElement) || button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    return true;
  })()`)
  if (!sent) throw new Error('ChatGPT 附件已经就绪，但发送按钮不可用')
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
  if (!conversationId) throw new Error('对话已经发送，但无法取得对话标识')
  return conversationId
}

async function waitForGuideAnswer(
  cdp: EdgeCdp,
  sessionId: string,
  conversationId: string,
  projectId: string | null,
): Promise<string> {
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    if (guideCancelled) throw new Error('ChatGPT 后台任务已取消')
    const state = await evaluateValue<{
      content: string
      finished: boolean
      loaded: boolean
      gizmoId: string | null
      projectId: string | null
    }>(cdp, sessionId, `(async () => {
      try {
        const authResponse = await fetch('/api/auth/session', { credentials: 'include' });
        const auth = authResponse.ok ? await authResponse.json() : null;
        if (!auth?.accessToken) return { content: '', finished: false, loaded: false };
        const response = await fetch('/backend-api/conversation/' + ${JSON.stringify(conversationId)}, {
          credentials: 'include',
          headers: { Authorization: 'Bearer ' + auth.accessToken },
        });
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
          gizmoId: typeof detail?.gizmo_id === 'string' ? detail.gizmo_id : null,
          projectId: typeof detail?.project_id === 'string' ? detail.project_id : null,
        };
      } catch { return { content: '', finished: false, loaded: false, gizmoId: null, projectId: null }; }
    })()`)
    if (projectId && state.loaded && !conversationBelongsToProject({ gizmo_id: state.gizmoId, project_id: state.projectId }, projectId)) {
      throw new Error(`新建对话未归属“${PROJECT_NAME}”，本次导读未保存`)
    }
    if (state.finished && state.content.trim()) return state.content
    await delay(8_000)
  }
  throw new Error('等待 ChatGPT 完成导读超时')
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
    const connection = await inspectChatGptPage(cdp, sessionId)
    if (connection.blocked) throw new Error(connection.message)
    if (!connection.authenticated) throw new Error('ChatGPT 登录态无效，请在设置中重新登录。')
    const project = request.projectName?.trim() ? await navigateToProject(cdp, sessionId, request.projectName.trim()) : null
    const tier = request.tier === 'pro' ? 'pro' : 'plus'
    const target = chatGptTarget(tier)

    emit({ status: 'running', stage: 'selecting-model', message: '正在确认 ' + target.model + ' · ' + target.effort, attempt })
    await selectGuideModel(cdp, sessionId, tier)

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
    submitted = true // From this point retrying could create another billable conversation.
    const conversationId = await submitGuideTask(cdp, sessionId, promptText)

    emit({ status: 'running', stage: 'waiting', message: target.model + ' · ' + target.effort + ' 正在生成导读', attempt })
    return await waitForGuideAnswer(cdp, sessionId, conversationId, project?.projectId || null)
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
  if (activeEdgeProcess) return { success: false, authenticated: false, projectVisible: false, message: 'Edge 后台任务正在运行。' }
  const { child, cdp } = await startEdge(profileDirectory, 'background-window')
  try {
    if (cookies.length > 0) await cdp.send('Storage.setCookies', { cookies })
    const sessionId = await openPage(cdp, CHATGPT_URL)

    const deadline = Date.now() + 20_000
    let result: ChatGptProbeResult | null = null
    while (Date.now() < deadline) {
      result = await inspectChatGptPage(cdp, sessionId)
      if (result.blocked || result.authenticated) break
      await delay(500)
    }
    return result || {
      success: false,
      authenticated: false,
      projectVisible: false,
      message: '没有检测到 ChatGPT 登录态。',
    }
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
    'Edge 页面加载超时',
  ]
  if (known.includes(message)) return message
  if (/^net::ERR_[A-Z_]+$/.test(message)) return 'ChatGPT 页面暂时无法打开，请检查网络后重新打开登录窗口。'
  return '专用浏览器连接失败，请检查 Edge 与网络后重试。'
}

export function registerChatGptEdgeWorker(getWindow: WindowProvider): void {
  const profileDirectory = () => path.join(app.getPath('userData'), 'chatgpt-edge-profile')
  const emit = (progress: ChatGptGuideProgress) => { const w = getWindow(); if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('chatgpt-guide-progress', progress) }
  const handle = (channel: string, action: (...args: any[]) => Promise<any>) => ipcMain.handle(channel, async (...args) => {
    if (workerBusy) return { success: false, authenticated: false, projectVisible: false, message: '专用浏览器正在工作，请完成或关闭登录窗口后重试。' }
    workerBusy = true; guideCancelled = false
    try { return await action(...args) }
    catch (error) { return { success: false, authenticated: false, projectVisible: false, message: connectionFailureMessage(error) } }
    finally { workerBusy = false }
  })
  handle('chatgpt-login', async (): Promise<ChatGptProbeResult> => {
    return launchManualChatGptLogin(profileDirectory())
  })
  handle('chatgpt-logout', async (): Promise<ChatGptProbeResult> => {
    const { child, cdp } = await startEdge(profileDirectory(), 'background-window')
    try { await cdp.send('Storage.clearCookies') }
    finally { await cdp.close(); await waitForExit(child, 3000); activeEdgeProcess = null; activeEdgeCdp = null }
    return { success: true, authenticated: false, projectVisible: false, message: '已清除播放器专用 ChatGPT 登录态。' }
  })

  handle('chatgpt-import-cookies', async (): Promise<ChatGptProbeResult> => {
    try {
      const cookies = parseChatGptCookies(await clipboard.readText())
      if (cookies.length === 0) {
        return { success: false, authenticated: false, projectVisible: false, message: '剪贴板里没有 ChatGPT 的 Cookie-Editor JSON。' }
      }
      clipboard.clear()
      return await probeChatGpt(profileDirectory(), cookies)
    } catch (error) {
      return {
        success: false,
        authenticated: false,
        projectVisible: false,
        message: error instanceof Error ? error.message : '导入 ChatGPT 登录态失败。',
      }
    }
  })

  handle('chatgpt-probe', async (): Promise<ChatGptProbeResult> => {
    try {
      return await probeChatGpt(profileDirectory())
    } catch (error) {
      return {
        success: false,
        authenticated: false,
        projectVisible: false,
        message: error instanceof Error ? error.message : '检测 ChatGPT 登录态失败。',
      }
    }
  })

  handle('chatgpt-generate-guide', async (_event, request: ChatGptGuideRequest): Promise<ChatGptGuideResult> => {
    if (activeEdgeProcess) return { success: false, message: 'Edge 后台任务正在运行。' }
    if (typeof request?.taskMarkdown !== 'string' || !request.taskMarkdown.trim() || request.taskMarkdown.length > 8_000_000) return { success: false, message: '导读任务内容为空。' }

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
          lastError = error instanceof Error ? error.message : lastError
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
