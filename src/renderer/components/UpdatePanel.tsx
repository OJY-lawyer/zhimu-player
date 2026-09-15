import { useEffect, useState } from 'react'
import type { AppUpdateAPI, AppUpdateState } from '../../shared/updateTypes'
import { useI18n } from '../i18n'
import '../styles/updates.css'

export function UpdatePanel() {
  const { t } = useI18n()
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [requestError, setRequestError] = useState(false)
  const api = window.electronAPI as typeof window.electronAPI & AppUpdateAPI
  useEffect(() => {
    let live = true
    let receivedEvent = false
    const unsubscribe = api.onAppUpdateState(next => { receivedEvent = true; if (live) setState(next) })
    api.getAppUpdateState().then(next => { if (live && !receivedEvent) setState(next) }).catch(() => { if (live) setRequestError(true) })
    return () => { live = false; unsubscribe() }
  }, [])
  const run = async (action: () => Promise<AppUpdateState>) => {
    setRequestError(false)
    try { setState(await action()) } catch { setRequestError(true) }
  }
  const error = state?.error
  const errorText = error === 'not-published' ? t('更新尚未发布，或当前无法访问发布页面。请稍后再试。', 'No update release is available, or its page cannot be reached. Try again later.')
    : error === 'integrity' ? t('更新校验未通过，未安装。请重新检查并下载。', 'Update verification failed. Nothing was installed. Check again and retry the download.')
      : error === 'save' ? t('保存或关闭未完成，更新已保留。处理后可重新点击重启更新。', 'Saving or closing was not completed. The update is kept; restart to update when ready.')
        : error === 'invalid-release' ? t('更新信息不完整，未继续下载或安装。', 'The release information is invalid. Download or installation was stopped.')
          : error === 'install' ? t('未能启动安装程序，请重新打开播放器后再试。', 'The installer could not start. Reopen the player and try again.')
            : error === 'download' ? t('下载失败，未安装。检查网络后重新检查更新。', 'Download failed. Nothing was installed. Check your connection and check for updates again.')
              : t('暂时无法连接更新服务，请检查网络后重试。', 'Cannot reach the update service. Check your connection and try again.')
  const status = !state ? t('正在读取更新状态…', 'Loading update status…')
    : state.phase === 'unsupported' ? state.unsupportedReason === 'portable'
      ? t('便携版请下载新版便携程序进行替换。', 'For the portable edition, download and replace it with a newer portable executable.')
      : t('安装版支持在此下载和安装更新。', 'The installed edition supports downloading and installing updates here.')
    : state.phase === 'checking' ? t('正在检查更新…', 'Checking for updates…')
    : state.phase === 'available' ? t(`发现新版本 ${state.version}`, `Version ${state.version} is available`)
    : state.phase === 'current' ? t('当前已是此渠道的最新版本。', 'You have the latest version on this channel.')
    : state.phase === 'downloading' ? t(`正在下载 ${Math.floor(state.percent || 0)}%`, `Downloading ${Math.floor(state.percent || 0)}%`)
    : state.phase === 'downloaded' ? t(`版本 ${state.version} 已就绪，重启后完成更新。`, `Version ${state.version} is ready. Restart to finish updating.`)
    : state.phase === 'installing' ? t('正在保存并关闭播放器…', 'Saving and closing the player…')
    : state.phase === 'error' ? errorText
    : t('手动检查，有更新时由你决定下载与重启。', 'Check manually, then choose when to download and restart.')
  const busy = state?.phase === 'checking' || state?.phase === 'downloading' || state?.phase === 'installing'
  return <section className="app-updates" aria-labelledby="app-updates-title">
    <div className="app-updates-copy">
      <h3 id="app-updates-title">{t('应用更新', 'App updates')} {state?.channel === 'preview' && <span>{t('预览渠道', 'Preview channel')}</span>}</h3>
      <p role="status" aria-live="polite">{requestError ? errorText : status}</p>
      {state?.phase === 'downloaded' && error && <p className="app-updates-error">{errorText}</p>}
      {state?.phase === 'downloading' && <progress aria-label={t('更新下载进度', 'Update download progress')} value={state.percent || 0} max={100} />}
      <small>{state?.downloadMode === 'full'
        ? t('差异下载不可用，已改为完整安装包下载。', 'Differential download is unavailable; downloading the full installer.')
        : t('优先下载变更部分；必要时下载完整安装包。更新保留安装目录、设置与登录态。', 'Downloads changed parts when possible, otherwise the full installer. Updates keep the installation folder, settings and sign-ins.')}</small>
    </div>
    {state?.phase !== 'unsupported' && <button type="button" className="app-updates-action" disabled={busy || (!state && !requestError)}
      onClick={() => void run(() => !state ? api.getAppUpdateState() : state.phase === 'available' ? api.downloadAppUpdate() : state.phase === 'downloaded' ? api.installAppUpdate() : api.checkAppUpdates())}>
      {state?.phase === 'available' ? t('下载更新', 'Download update') : state?.phase === 'downloaded' ? t('重启更新', 'Restart to update')
        : state?.phase === 'downloading' ? t('下载中…', 'Downloading…') : state?.phase === 'installing' ? t('正在保存…', 'Saving…')
          : state?.phase === 'checking' ? t('检查中…', 'Checking…') : t('检查更新', 'Check for updates')}
    </button>}
  </section>
}
