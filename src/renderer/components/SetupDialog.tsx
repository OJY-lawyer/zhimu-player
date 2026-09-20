import { useEffect, useRef, useState } from 'react'
import type { AIConfig, ApiModelsResult, ChatGptModelsResult, ChatGptProbeResult, ConnectionResult } from '../../shared/contracts'
import { CHATGPT_WEB_PRESETS, DEEPSEEK_MODEL, DEEPSEEK_URL, chatGptTarget, normalizeChatGptSelection } from '../../shared/guideGeneration'
import { useI18n } from '../i18n'
import { APP_NAME_ZH, APP_NAME_EN } from '../../shared/brand'
import { Icon } from './Icons'
import './setup.css'

interface Props { config: AIConfig; onboarding?: boolean; onSave: (config: AIConfig) => Promise<void>; onClose: () => void; onAbout: () => void; onRestartSetup: () => void }
// Session-only evidence survives closing Settings. It never persists account details or cookies.
let lastConfirmedChatStatus: ChatGptProbeResult | null = null
export function SetupDialog({ config, onboarding = false, onSave, onClose, onAbout, onRestartSetup }: Props) {
  const { language, setLanguage, t, translateMessage } = useI18n()
  const [draft, setDraft] = useState<AIConfig>({ ...config, baseUrl: config.baseUrl || DEEPSEEK_URL, model: config.model || DEEPSEEK_MODEL })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [chat, setChat] = useState<ChatGptProbeResult | null>(null)
  const [confirmedChat, setConfirmedChat] = useState<ChatGptProbeResult | null>(() => lastConfirmedChatStatus)
  const [chatAction, setChatAction] = useState('')
  const [showCookieImport, setShowCookieImport] = useState(false)
  const [showCookiePaste, setShowCookiePaste] = useState(false)
  const [cookieText, setCookieText] = useState('')
  const [chatModels, setChatModels] = useState<ChatGptModelsResult | null>(null)
  const [chatModelsMessage, setChatModelsMessage] = useState('')
  const [asr, setAsr] = useState<ConnectionResult | null>(null)
  const [catalog, setCatalog] = useState<{ connection: string; result: ApiModelsResult } | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [editingConnection, setEditingConnection] = useState(false)
  const modelsRequest = useRef(0)
  const modelsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const cookiePaste = useRef<HTMLDivElement>(null)
  const source = draft.provider === 'compatible-api' ? 'compatible-api' : 'chatgpt-web'
  const patch = (fields: Partial<AIConfig>) => {
    if (fields.provider && fields.provider !== source) { setCookieText(''); setShowCookiePaste(false); setShowCookieImport(false) }
    setDraft(value => ({ ...value, ...fields }))
  }
  // Keep a result attached to its draft connection. An old request may finish after the user edits a key.
  const connection = JSON.stringify([draft.baseUrl, draft.apiKey, !!draft.clearApiKey])
  const modelList = catalog?.connection === connection ? catalog.result : null
  let savedKeyAvailable = false
  let canListModels = false
  try {
    const url = new URL(draft.baseUrl)
    savedKeyAvailable = !!config.hasApiKey && !draft.clearApiKey && url.origin === new URL(config.baseUrl).origin
    canListModels = !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      && (url.hostname !== 'api.deepseek.com' || !!draft.apiKey.trim() || savedKeyAvailable)
  } catch { /* Incomplete addresses are edited locally until valid. */ }
  const refreshModels = async () => {
    if (modelsTimer.current) { clearTimeout(modelsTimer.current); modelsTimer.current = null }
    const request = ++modelsRequest.current
    setModelsLoading(true)
    try {
      const result = await window.electronAPI.listApiModels({ baseUrl: draft.baseUrl, apiKey: draft.apiKey, clearApiKey: draft.clearApiKey })
      if (request === modelsRequest.current) setCatalog({ connection, result })
    } catch {
      if (request === modelsRequest.current) setCatalog({ connection, result: { models: [], source: 'none', error: 'unavailable' } })
    } finally { if (request === modelsRequest.current) setModelsLoading(false) }
  }
  useEffect(() => {
    ++modelsRequest.current
    setModelsLoading(false)
    if (source !== 'compatible-api' || (onboarding && step !== 1) || editingConnection || !canListModels) return
    // Fetch after leaving the key/address field, without sending partially typed credentials.
    modelsTimer.current = setTimeout(() => void refreshModels(), 150)
    return () => { if (modelsTimer.current) clearTimeout(modelsTimer.current); modelsTimer.current = null; ++modelsRequest.current }
  }, [connection, source, onboarding, step, editingConnection, canListModels])
  const modelStatus = modelsLoading ? t('正在获取可用模型…', 'Fetching available models…')
    : modelList?.source === 'live' ? (modelList.models.length ? t('已从接口获取模型列表。', 'Model list received from your API.') : t('接口返回的模型列表为空。可在高级设置中手动填写。', 'The API returned an empty model list. You can enter a name in Advanced settings.'))
    : modelList?.source === 'cache' ? t('暂时无法刷新，显示本次启动中缓存的列表。', 'Refresh unavailable. Showing the list cached during this app session.')
    : modelList?.error === 'unauthorized' ? t('API Key 无效或无权获取模型，请更新后重试。', 'This key is invalid or cannot list models. Update it and try again.')
    : modelList?.error === 'credentials' ? t('请填写此接口的 API Key。', 'Enter an API key for this API.')
    : modelList?.error === 'invalid-url' ? t('请在高级设置中填写有效的 API 地址。', 'Enter a valid API URL in Advanced settings.')
    : modelList?.error === 'timeout' ? t('获取模型超时，请刷新重试或手动填写。', 'Fetching models timed out. Refresh or enter a model name manually.')
    : modelList?.error ? t('暂时无法获取列表。请刷新重试，或在高级设置中手动填写。', 'The model list is unavailable. Refresh or enter a name in Advanced settings.')
    : t('填写 Key 后自动获取模型，也可手动刷新。', 'Models load after you enter your key. You can also refresh the list.')
  const listedModels = modelList?.models || []
  const unlistedModel = modelList?.source === 'live' && !!draft.model && !listedModels.includes(draft.model)
  const titles = [t('先选一种导读方式', 'Choose your guide source'), t('连接你的导读账号', 'Connect your guide account'), t('需要时，自动补齐字幕', 'Add subtitles when needed')]
  const selection = normalizeChatGptSelection(draft.chatGptSelection)
  const target = chatGptTarget(selection)
  const displayedError = error === 'chat-selection-required'
    ? t('请选择 ChatGPT 网页模型和推理档位，或稍后设置。', 'Choose a ChatGPT web model and reasoning level, or skip setup for now.')
    : error === 'chat-selection-unavailable'
    ? t('当前选择不在刚读取的网页菜单中，请重新选择模型和推理档位。', 'Your selection is not in the website menu just received. Choose an available model and reasoning level.')
    : translateMessage(error)
  const chatModelOptions = chatModels?.success ? chatModels.models : CHATGPT_WEB_PRESETS
  const selectedChatModel = chatModelOptions.find(option => option.model === draft.chatGptSelection?.model)
  const reasoningOptions = selectedChatModel?.reasoningOptions || []
  const needsReasoningChoice = reasoningOptions.length > 0 && !draft.chatGptSelection?.reasoning
  const unlistedChatModel = !!draft.chatGptSelection?.model && !selectedChatModel
  const unlistedReasoning = !!draft.chatGptSelection?.reasoning && !reasoningOptions.includes(draft.chatGptSelection.reasoning)
  const reasoningLabel = (value: string) => ({ Instant: t('即时', 'Instant'), Medium: t('中', 'Medium'), High: t('高', 'High'), 'Extra High': t('极高', 'Extra High') }[value] || value)
  const acceptChatResult = (result: ChatGptProbeResult, action: string) => {
    const authStatus = result.authStatus || (result.authenticated ? 'authenticated' : action === 'logout' && result.success ? 'signed-out' : 'unknown')
    const next = { ...result, authStatus }
    setChat(next)
    setChatAction(action)
    if (authStatus !== 'unknown') {
      lastConfirmedChatStatus = next
      setConfirmedChat(next)
    }
    if (action === 'import' || action === 'logout') { setChatModels(null); setChatModelsMessage('') }
  }
  const languageSwitcher = <div className="setup-language">
    <span>{t('界面语言', 'Interface language')}</span>
    <div className="setup-language-switch" role="group" aria-label={t('界面语言', 'Interface language')}>
      <button type="button" data-ui-language="zh-CN" aria-pressed={language === 'zh-CN'} onClick={() => setLanguage('zh-CN')}>中文</button>
      <button type="button" data-ui-language="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
    </div>
  </div>
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus() }, [])
  useEffect(() => {
    if (!showCookiePaste) return
    cookiePaste.current?.querySelector('textarea')?.focus({ preventScroll: true })
    cookiePaste.current?.scrollIntoView({ block: 'nearest' })
  }, [showCookiePaste])
  const act = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name); setError('')
    if (name.startsWith('chat-import')) { setCookieText(''); setShowCookiePaste(false) }
    try { await action() } catch (e) {
      const message = e instanceof Error ? e.message : '操作未完成，请重试。'
      if (name.startsWith('chat-') && name !== 'chat-models') acceptChatResult({ success: false, authenticated: false, authStatus: 'unknown', projectVisible: false, message }, name.startsWith('chat-import') ? 'import' : 'check')
      else setError(message)
    }
    finally { setBusy('') }
  }
  const save = async (skip = false) => {
    if (!skip && source === 'chatgpt-web' && (!selection || needsReasoningChoice)) {
      setError('chat-selection-required')
      return
    }
    if (!skip && source === 'chatgpt-web' && chatModels?.success && (unlistedChatModel || unlistedReasoning)) {
      setError('chat-selection-unavailable')
      return
    }
    if (!skip && source === 'compatible-api') {
      try {
        const url = new URL(draft.baseUrl)
        if (url.username || url.password || url.search || url.hash || !draft.model.trim()) throw new Error()
        if (url.hostname === 'api.deepseek.com' && !draft.apiKey.trim() && !savedKeyAvailable) { setError('请填写 DeepSeek API Key，或稍后配置。'); return }
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error()
      } catch { setError('请输入有效的 HTTPS API 地址和模型名称。'); return }
    }
    await act('save', async () => { await onSave({ ...draft, chatGptSelection: selection, provider: source, setupCompleted: true }); onClose() })
  }
  const picker = <div className="setup-source-options" role="radiogroup" aria-label={t('导读来源', 'Guide source')}>
    {([
      ['chatgpt-web', t('ChatGPT 网页', 'ChatGPT web'), t('使用你自己的 ChatGPT 账号', 'Use your own ChatGPT account'), t('默认', 'Default')],
      ['compatible-api', 'DeepSeek API', t('使用 API Key，按调用计费', 'Use an API key with usage-based billing'), t('可选', 'Optional')],
    ] as const).map(([provider, title, description, badge]) => <button type="button" role="radio" aria-checked={source === provider} key={provider} className={'setup-source ' + (source === provider ? 'is-selected' : '')} disabled={!!busy} onClick={() => patch({ provider })}>
      <span className="setup-choice-dot" /><span><strong>{title} <small>{badge}</small></strong><span>{description}</span></span>
    </button>)}
  </div>
  const chatConnection = <section className="setup-chat-connection" aria-label={t('ChatGPT 连接', 'ChatGPT connection')}>
    <div className="setup-chat-connection-heading">
      <strong>{chat?.authStatus === 'authenticated' ? t('已登录 ChatGPT', 'Signed in to ChatGPT') : chatAction === 'login' && chat?.success ? t('等待你完成登录', 'Complete sign-in in Edge') : confirmedChat?.authenticated ? t('上次已确认登录', 'Previously confirmed signed in') : chat?.authStatus === 'signed-out' ? t('尚未登录 ChatGPT', 'Signed out of ChatGPT') : t('ChatGPT 连接', 'ChatGPT connection')}</strong>
      {confirmedChat?.authenticated && <button type="button" className="text-button" disabled={!!busy} onClick={() => void act('chat-logout', async () => acceptChatResult(await window.electronAPI.logoutChatGpt(), 'logout'))}>{t('退出专用账号', 'Sign out of this session')}</button>}
    </div>
    <p className="setup-chat-status" role="status">{busy === 'chat-login' ? t('正在打开普通 Edge 登录窗口…', 'Opening a regular Edge sign-in window…') : busy === 'chat-check' ? t('正在检查专用浏览器的登录状态…', 'Checking sign-in status in the dedicated browser…') : chat?.message ? translateMessage(chat.message) : chat?.authStatus === 'unknown' ? t('本次未能检查连接，请稍后重试。', 'The connection could not be checked. Please try again later.') : t('网页登录完成后关闭该窗口，再检查连接；已有登录可直接导入 Cookie。', 'Sign in in the browser. Close it when finished, then check the connection. You can also import an existing session.')}</p>
    {chat?.authStatus === 'unknown' && chatAction !== 'login' && confirmedChat?.authenticated && <p className="setup-status-pending">{t('保留上次已登录记录；本次检查失败不表示账号已退出。', 'Your last confirmed sign-in is retained; a failed check does not mean you were signed out.')}</p>}
    <div className="setup-chat-actions" role="group" aria-label={t('登录与连接', 'Sign-in and connection')}>
      <button type="button" className="button-primary" disabled={!!busy} onClick={() => void act('chat-login', async () => acceptChatResult(await window.electronAPI.loginChatGpt(), 'login'))}>{busy === 'chat-login' ? t('正在打开…', 'Opening…') : t('打开登录窗口', 'Open sign-in')}</button>
      <button type="button" className="button-secondary" aria-expanded={showCookieImport} aria-controls="chat-cookie-import" disabled={!!busy} onClick={() => { if (showCookieImport) { setCookieText(''); setShowCookiePaste(false) }; setShowCookieImport(!showCookieImport) }}>{t('导入 Cookie', 'Import cookies')}</button>
      <button type="button" className="button-secondary" disabled={!!busy} onClick={() => void act('chat-check', async () => acceptChatResult(await window.electronAPI.probeChatGpt(), 'check'))}>{busy === 'chat-check' ? t('正在检查…', 'Checking…') : t('检查连接', 'Check connection')}</button>
    </div>
    {showCookieImport && <div id="chat-cookie-import" className="setup-cookie-import">
      <p>{t('在已登录的 chatgpt.com 页面，用 Cookie-Editor 导出 JSON，然后选择导入方式。', 'On a signed-in chatgpt.com page, export JSON with Cookie-Editor, then choose how to import it.')}</p>
      <div className="setup-cookie-actions">
        <button type="button" className="button-secondary" disabled={!!busy} onClick={() => void act('chat-import-file', async () => acceptChatResult(await window.electronAPI.importChatGptCookies('file'), 'import'))}>{busy === 'chat-import-file' ? t('正在导入…', 'Importing…') : t('从 JSON 文件导入', 'Import JSON file')}</button>
        <button type="button" className="button-secondary" disabled={!!busy} onClick={() => void act('chat-import-clipboard', async () => acceptChatResult(await window.electronAPI.importChatGptCookies('clipboard'), 'import'))}>{busy === 'chat-import-clipboard' ? t('正在导入…', 'Importing…') : t('从剪贴板导入', 'Import clipboard')}</button>
        <button type="button" className="button-secondary" aria-expanded={showCookiePaste} aria-controls="chat-cookie-paste" disabled={!!busy} onClick={() => { if (showCookiePaste) setCookieText(''); setShowCookiePaste(!showCookiePaste) }}>{t('粘贴 JSON', 'Paste JSON')}</button>
      </div>
      {showCookiePaste && <div id="chat-cookie-paste" className="setup-cookie-paste" ref={cookiePaste}>
        <label htmlFor="chat-cookie-json">{t('粘贴 Cookie-Editor 导出的 JSON', 'Paste the JSON exported by Cookie-Editor')}</label>
        <textarea id="chat-cookie-json" value={cookieText} rows={4} spellCheck={false} autoComplete="off" autoCapitalize="off" disabled={!!busy} onChange={e => setCookieText(e.target.value)} placeholder={t('粘贴后点击导入，内容会立即清空', 'Paste here, then import. The field clears immediately.')} />
        <button type="button" className="button-primary" disabled={!!busy || !cookieText.trim()} onClick={() => {
          const raw = cookieText
          setCookieText(''); setShowCookiePaste(false)
          void act('chat-import-paste', async () => acceptChatResult(await window.electronAPI.importChatGptCookies('paste', raw), 'import'))
        }}>{t('导入粘贴内容', 'Import pasted JSON')}</button>
      </div>}
      <p className="setup-note">{t('Cookie 仅在本机读取，可能过期。导入后检查连接，请勿分享导出文件。', 'Cookies are read locally and may expire. Check the connection after importing, and keep your export private.')}</p>
    </div>}
  </section>
  const route = source === 'chatgpt-web' ? <div className="setup-route">
    {chatConnection}
    <div className="setup-chat-model-fields">
      <label className="setup-field" htmlFor="chat-model">{t('网页模型', 'Web model')}<select id="chat-model" value={draft.chatGptSelection?.model || ''} disabled={!!busy} aria-describedby="chat-model-status" onChange={e => {
        const option = chatModelOptions.find(item => item.model === e.target.value)
        if (!option) return
        patch({ chatGptSelection: { model: option.model, reasoning: option.reasoningOptions.length ? (draft.chatGptSelection?.reasoning && option.reasoningOptions.includes(draft.chatGptSelection.reasoning) ? draft.chatGptSelection.reasoning : '') : null } })
      }}><option value="" disabled>{t('选择模型', 'Choose a model')}</option>{unlistedChatModel && <option value={draft.chatGptSelection!.model}>{draft.chatGptSelection!.model}{t(' · 当前设置', ' · Saved choice')}</option>}{chatModelOptions.map(option => <option key={option.model} value={option.model}>{option.model}</option>)}</select></label>
      <label className="setup-field" htmlFor="chat-reasoning">{t('推理档位', 'Reasoning level')}<select id="chat-reasoning" value={draft.chatGptSelection?.reasoning || ''} disabled={!!busy || !draft.chatGptSelection?.model || (!!selectedChatModel && reasoningOptions.length === 0)} onChange={e => draft.chatGptSelection && patch({ chatGptSelection: { ...draft.chatGptSelection, reasoning: e.target.value } })}>
        <option value="" disabled>{selectedChatModel && reasoningOptions.length === 0 ? t('按网页默认', 'Website default') : t('选择推理档位', 'Choose a reasoning level')}</option>
        {unlistedReasoning && <option value={draft.chatGptSelection!.reasoning!}>{reasoningLabel(draft.chatGptSelection!.reasoning!)}{t(' · 当前设置', ' · Saved choice')}</option>}
        {reasoningOptions.map(value => <option key={value} value={value}>{reasoningLabel(value)}</option>)}
      </select></label>
    </div>
    <div className="setup-inline-actions"><button type="button" disabled={!!busy} onClick={() => void act('chat-models', async () => {
      const result = await window.electronAPI.listChatGptModels()
      if (result.success) setChatModels(result)
      setChatModelsMessage(result.message || (result.success ? t('已读取网页菜单。', 'Website menu received.') : t('本次未能刷新，请检查登录后重试。', 'Could not refresh. Check your connection and try again.')))
    })}>{busy === 'chat-models' ? t('正在读取网页选项…', 'Reading website options…') : t('从 ChatGPT 刷新可用选项', 'Refresh options from ChatGPT')}</button></div>
    <p id="chat-model-status" className="setup-model-status" role="status">{chatModelsMessage ? translateMessage(chatModelsMessage) : chatModels?.success ? t('已读取当前网页选项，原有选择保持不变。', 'Website options received. Your existing choice is unchanged.') : t('候选选项，尚未核实账号权限。登录后可刷新。', 'Preset options; account access is not yet verified. Refresh after sign-in.')}</p>
    {chatModels?.success && (unlistedChatModel || unlistedReasoning) && <p className="setup-model-warning">{t('原选择不在本次网页选项中，请重新选择可用的模型和档位。不会自动降级。', 'Your saved choice is not in the current website options. Choose an available model and level; the app will not downgrade automatically.')}</p>}
    {selection && <p>{t('生成时使用：', 'Selected for generation: ')}{target.model}{target.effort && ' · ' + reasoningLabel(target.effort)}{t('。以网页实际可用项为准，无法确认时会停下。', '. Generation stops if this selection cannot be confirmed on the website.')}</p>}
    <p className="setup-note">{t('生成时向 ChatGPT 网页发送字幕，使用你的网页账号额度。', 'Generation sends subtitles to ChatGPT web and uses your web account allowance.')}</p>
    <details className="setup-advanced"><summary>{t('高级设置', 'Advanced settings')}</summary><label className="setup-field">{t('ChatGPT 项目名称（可选）', 'ChatGPT project name (optional)')}<input value={draft.chatGptProject || ''} disabled={!!busy} onChange={e => patch({ chatGptProject: e.target.value })} placeholder={t('留空则每次创建普通新对话', 'Leave blank to start a regular new chat each time')} /></label><p>{t('填写时需先在账号中创建同名项目。新用户可以留空。', 'Create a project with this exact name in your account first, or leave this field blank.')}</p></details>
  </div> : <div className="setup-route">
    <label className="setup-field" htmlFor="api-key">API Key<input id="api-key" type="password" autoComplete="off" spellCheck={false} value={draft.apiKey} disabled={!!busy} onFocus={() => setEditingConnection(true)} onBlur={() => setEditingConnection(false)} onChange={e => patch({ apiKey: e.target.value, clearApiKey: false })} placeholder={savedKeyAvailable ? t('已加密保存；留空保留原 Key', 'Encrypted key saved; leave blank to keep it') : t('从 DeepSeek 开放平台取得 API Key', 'Get an API key from the DeepSeek platform')} /></label>
    <div className="setup-field"><label htmlFor="api-model">{t('导读模型', 'Guide model')}</label><div className="setup-model-picker"><select id="api-model" value={draft.model} disabled={!!busy} aria-describedby="api-model-status" onChange={e => patch({ model: e.target.value })}>
      {!draft.model && <option value="">{t('选择模型', 'Choose a model')}</option>}
      {!!draft.model && !listedModels.includes(draft.model) && <option value={draft.model}>{draft.model}{unlistedModel ? t(' · 未在列表中', ' · Not in list') : ''}</option>}
      {listedModels.map(model => <option value={model} key={model}>{model}</option>)}
    </select><button type="button" className="button-secondary" disabled={!!busy || modelsLoading || !canListModels} onClick={() => void refreshModels()}>{modelsLoading ? t('获取中…', 'Loading…') : t('刷新模型', 'Refresh models')}</button></div></div>
    <p id="api-model-status" className="setup-model-status" role="status">{modelStatus}</p>
    {unlistedModel && <p className="setup-model-warning">{t('当前模型未在本次列表中。请选择可用模型，或在高级设置中确认名称；不会自动替换你的选择。', 'Your current model is not in this list. Choose an available model or confirm its name in Advanced settings. Your selection is never replaced automatically.')}</p>}
    <p>{t('密钥仅在本机加密保存。生成时把字幕发送给所选接口，使用该账号余额。', 'Your key is stored encrypted on this device. Generation sends subtitles to the selected API and uses that account’s balance.')}</p>
    {draft.hasApiKey && <label className="setup-check"><input type="checkbox" checked={draft.clearApiKey || false} onChange={e => patch({ clearApiKey: e.target.checked, ...(e.target.checked ? { apiKey: '' } : {}) })} />{t('删除已保存的 Key', 'Delete the saved key')}</label>}
    <details className="setup-advanced"><summary>{t('高级设置 · 兼容接口', 'Advanced · Compatible API')}</summary><label className="setup-field" htmlFor="api-url">{t('API 地址', 'API URL')}<input id="api-url" value={draft.baseUrl} disabled={!!busy} onFocus={() => setEditingConnection(true)} onBlur={() => setEditingConnection(false)} onChange={e => patch({ baseUrl: e.target.value })} /></label><label className="setup-field" htmlFor="api-model-manual">{t('手动填写模型名称', 'Enter a model name manually')}<input id="api-model-manual" value={draft.model} disabled={!!busy} onChange={e => patch({ model: e.target.value })} /></label><p>{t('兼容接口不支持模型列表时，可手动填写准确名称。列表只提供名称，不代表模型能力或价格。', 'If your API cannot list models, enter the exact model name. The list does not describe capabilities or pricing.')}</p><button type="button" className="text-button" disabled={!!busy} onClick={() => patch({ baseUrl: DEEPSEEK_URL, model: DEEPSEEK_MODEL })}>{t('恢复 DeepSeek 默认值', 'Restore DeepSeek defaults')}</button></details>
  </div>
  const transcription = <section className="setup-asr">
    <div className="setup-row"><label htmlFor="asr-language">{t('视频语音', 'Spoken language')}</label><select id="asr-language" value={draft.asrLanguage || 'cn'} disabled={!!busy} onChange={e => patch({ asrLanguage: e.target.value === 'en' ? 'en' : 'cn' })}><option value="cn">{t('中文', 'Chinese')}</option><option value="en">English</option></select></div>
    <div className="setup-connection"><div><strong>{asr?.authenticated ? t('听悟已连接', 'Tingwu connected') : t('通义听悟', 'Tongyi Tingwu')}</strong><p role="status">{asr?.message ? translateMessage(asr.message) : t('没有字幕的视频，可交给听悟生成。有同名 SRT 的视频无需转写。', 'Tingwu can transcribe videos without subtitles. Videos with a matching SRT file need no transcription.')}</p></div><button type="button" className="button-secondary" disabled={!!busy} onClick={() => void act('asr-login', async () => setAsr(await window.electronAPI.loginAsr()))}>{busy === 'asr-login' ? t('等待听悟登录…', 'Waiting for Tingwu…') : asr?.authenticated ? t('重新登录听悟', 'Sign in again') : t('登录听悟', 'Sign in to Tingwu')}</button></div>
    <div className="setup-inline-actions"><button type="button" disabled={!!busy} onClick={() => void act('asr-check', async () => setAsr(await window.electronAPI.probeAsr()))}>{busy === 'asr-check' ? t('正在检查…', 'Checking…') : t('检查连接', 'Check connection')}</button>{asr?.authenticated && <button type="button" disabled={!!busy} onClick={() => void act('asr-logout', async () => setAsr(await window.electronAPI.logoutAsr()))}>{t('退出听悟', 'Sign out of Tingwu')}</button>}</div>
    <p className="setup-note">{t('按视频中主要使用的语言选择，与界面及导读语言分别设置。仅在你点击“生成字幕”后上传视频，使用自己的听悟额度。取消本地等待不会删除云端记录，也不能撤回已经发生的消耗。', 'Choose the main language spoken in your video. This is separate from the interface and guide languages. Videos are uploaded only after you choose “Generate subtitles”, using your Tingwu allowance. Cancelling the local task does not delete cloud records or reverse usage already incurred.')}</p>
    {onboarding && <div className="setup-next-hint"><strong>{t('开始使用', 'Ready to begin')}</strong><p>{t('拖入视频或文件夹 → 补齐字幕 → 点击“生成导读”。字幕和导读中的时间戳都可以点击跳转。', 'Drop in a video or folder, add any missing subtitles, then choose “Generate guide”. Click subtitle entries or guide timestamps to jump to that moment.')}</p></div>}
  </section>
  return <div className="modal-overlay setup-overlay"><div ref={dialog} tabIndex={-1} className="setup-dialog" lang={language} data-onboarding={onboarding} role="dialog" aria-modal="true" aria-labelledby="setup-title" onKeyDown={e => {
    if (e.key === 'Escape' && !onboarding && !busy) onClose()
    if (e.key === 'Tab') { const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary') || [])].filter(n => n.getClientRects().length); const first = nodes[0], last = nodes[nodes.length - 1]; if (!nodes.includes(document.activeElement as HTMLElement) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); first?.focus() } else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() } }
  }}>
    <header className="setup-header"><div className="setup-heading-copy"><span className="setup-eyebrow">{t(APP_NAME_ZH, APP_NAME_EN)} {onboarding ? t(' / 首次使用', ' / WELCOME') : t(' / 设置', ' / SETTINGS')}</span><h1 id="setup-title">{onboarding ? titles[step] : t('连接与设置', 'Connections & settings')}</h1><p>{onboarding ? t('播放始终可用，智能功能按需连接。', 'Local playback is always ready. Connect AI features when you need them.') : t('更换账号或导读来源，下次生成时生效。', 'Account and guide source changes apply to your next generation.')}</p></div><div className="setup-header-actions">{languageSwitcher}{!onboarding && <button type="button" className="modal-close" aria-label={t('关闭设置', 'Close settings')} disabled={!!busy} onClick={onClose}><Icon name="close" size={18} /></button>}</div></header>
    {onboarding && <ol className="setup-steps" aria-label={t('设置进度', 'Setup progress')}>{[t('选择来源', 'Source'), t('连接导读', 'Account'), t('字幕与开始', 'Subtitles')].map((label, i) => <li key={i} aria-current={step === i ? 'step' : undefined} className={step === i ? 'is-current' : step > i ? 'is-done' : ''}><span>{i + 1}</span>{label}</li>)}</ol>}
    <main className="setup-content">{onboarding ? step === 0 ? <><p className="setup-intro">{t('把长视频变成可以点击的内容导读。选择你已有的账号，之后随时可以更换。', 'Turn long videos into guides you can click to navigate. Choose an account you already have; you can change this later.')}</p>{picker}<p className="setup-note">{t('两种方式共用字幕和导读文件，不会在失败时自动切换。', 'Both sources share the same subtitle and guide files. The app will not switch sources automatically if generation fails.')}</p></> : step === 1 ? route : transcription : <><h2>{t('内容导读', 'AI guides')}</h2>{picker}{route}<h2 className="setup-section-title">{t('字幕转写', 'Transcription')} <small>{t('按需使用', 'Optional')}</small></h2>{transcription}</>}{error && <p className="setup-error" role="alert">{displayedError}</p>}</main>
    <footer className="setup-footer">{onboarding ? <><button className="text-button" type="button" disabled={!!busy} onClick={() => void save(true)}>{t('稍后设置，先播放', 'Skip for now')}</button><div>{step > 0 && <button className="button-secondary" type="button" disabled={!!busy} onClick={() => setStep(step - 1)}>{t('上一步', 'Back')}</button>}<button className="button-primary" type="button" disabled={!!busy} onClick={() => step < 2 ? setStep(step + 1) : void save(true)}>{busy === 'save' ? t('正在保存…', 'Saving…') : step === 2 ? t('开始使用', 'Get started') : t('下一步', 'Next')}</button></div></> : <><div><button className="text-button" type="button" disabled={!!busy} onClick={onAbout}>{t('关于与支持', 'About & support')}</button><button className="text-button" type="button" disabled={!!busy} onClick={onRestartSetup}>{t('使用引导', 'Setup guide')}</button></div><button className="button-primary" type="button" disabled={!!busy} onClick={() => void save()}>{busy === 'save' ? t('正在保存…', 'Saving…') : t('保存设置', 'Save settings')}</button></>}</footer>
  </div></div>
}
