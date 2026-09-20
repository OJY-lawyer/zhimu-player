/** Self-contained page evaluation. Returns status only, never session contents. */
export function chatGptPageProbeExpression(projectName: string): string {
  const project = typeof projectName === 'string' ? projectName : ''
  return `(async () => {
    const projectName = ${JSON.stringify(project)};
    const text = () => document.body?.innerText || '';
    const projectVisible = Boolean(projectName.trim()) && text().includes(projectName);
    let currentUrl = '';
    let correctOrigin = false;
    try { const url = new URL(location.href); currentUrl = url.origin + url.pathname; correctOrigin = url.protocol === 'https:' && url.hostname === 'chatgpt.com'; } catch {}
    const challenge = () => {
      const title = document.title || '';
      const body = text().slice(0, 1600);
      const prompt = document.querySelector('#prompt-textarea, [data-testid="prompt-textarea"]');
      const challengeElement = document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, iframe[src*="challenges.cloudflare.com"]');
      return Boolean(challengeElement) || /just a moment|verify you are human|验证您是真人|安全验证/i.test(title)
        || !prompt && /verify (?:that )?you are human|checking your browser|验证您是真人|确认您是真人/i.test(body);
    };
    const result = (authStatus, message, blocked = false) => ({
      success: authStatus === 'authenticated', authenticated: authStatus === 'authenticated',
      authStatus, projectVisible, blocked, currentUrl, message,
    });
    const unknown = () => result('unknown', '暂时无法确认 ChatGPT 登录状态，请稍后检查；无需立即重新登录。');
    const blockedResult = () => result('unknown', 'ChatGPT 要求进行人机验证，请在浏览器中手动完成后再检查。', true);
    if (challenge()) return blockedResult();
    if (!correctOrigin || document.readyState !== 'complete') return unknown();
    const loginAction = () => [...document.querySelectorAll('a,button,[role="button"]')].some(node => {
      const label = (node.textContent || node.getAttribute?.('aria-label') || '').trim();
      if (!/^(log in|sign in|sign up|登录|登入|注册)$/i.test(label) || node.hidden || node.getAttribute?.('aria-hidden') === 'true') return false;
      if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) return false;
      if (typeof getComputedStyle === 'function') { const style = getComputedStyle(node); if (style.display === 'none' || style.visibility === 'hidden') return false; }
      return true;
    });
    const controller = new AbortController();
    let timer;
    try {
      const fetchSession = (async () => {
        try {
          const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
          if (response.status === 401) return 'signed-out';
          if (response.status === 403) return 'access-denied';
          if (response.status !== 200 || !response.ok) return 'unknown';
          const session = await response.json();
          if (!session || typeof session !== 'object' || Array.isArray(session)) return 'unknown';
          if (session.user && typeof session.user === 'object' && !Array.isArray(session.user) && Object.keys(session.user).length) return 'authenticated';
          const emptySession = (session.user === undefined || session.user === null)
            && Object.keys(session).every(key => key === 'user' || key === 'expires')
            && (session.expires === undefined || typeof session.expires === 'string');
          return emptySession && loginAction() ? 'signed-out' : 'unknown';
        } catch { return 'unknown'; }
      })();
      const timeout = new Promise(resolve => { timer = setTimeout(() => { resolve('timeout'); controller.abort(); }, 6000); });
      const state = await Promise.race([fetchSession, timeout]);
      if (challenge()) return blockedResult();
      if (document.readyState !== 'complete') return unknown();
      if (state === 'authenticated') return result('authenticated', 'ChatGPT 登录成功。模型与思考档位会在生成前核验。');
      if (state === 'signed-out') return result('signed-out', 'ChatGPT 尚未登录，请在浏览器中完成登录。');
      if (state === 'access-denied') return result('unknown', 'ChatGPT 拒绝了本次连接（403）。登录资料已保留，请打开登录窗口按网页提示处理后再检查。', true);
      if (state === 'timeout') return result('unknown', '检查 ChatGPT 登录状态超时，请稍后重试。');
      return unknown();
    } finally { clearTimeout(timer); controller.abort(); }
  })()`
}
