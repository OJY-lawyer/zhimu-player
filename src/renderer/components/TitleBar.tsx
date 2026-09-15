import { Icon } from './Icons'
import { t } from '../i18n'
import { APP_NAME_ZH, APP_NAME_EN } from '../../shared/brand'

const APP_ICON_URL = new URL('../../../assets/app-icon.png', import.meta.url).href

interface TitleBarProps {
  title: string
  subtitle?: string
  isAlwaysOnTop: boolean
  onToggleAlwaysOnTop: () => void
  onOpenSettings: () => void
}

export function TitleBar({
  title,
  subtitle,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  onOpenSettings,
}: TitleBarProps) {
  return (
    <header className="title-bar">
      <div className="title-identity">
        <img className="app-mark" src={APP_ICON_URL} alt="" aria-hidden="true" />
        <strong>{title || t(APP_NAME_ZH, APP_NAME_EN)}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="title-bar-controls">
        <button className="title-bar-button" type="button" title={t('设置与关于', 'Settings & about')} onClick={onOpenSettings}><Icon name="settings" size={16} /></button>
        <button
          className={'title-bar-button pin-window ' + (isAlwaysOnTop ? 'is-active' : '')}
          type="button"
          title={isAlwaysOnTop ? t('取消窗口置顶', 'Stop keeping on top') : t('窗口置顶', 'Keep on top')}
          aria-pressed={isAlwaysOnTop}
          onClick={onToggleAlwaysOnTop}
        >
          <Icon name="pin" size={15} />
        </button>
        <button className="title-bar-button" type="button" title={t('最小化', 'Minimize')} onClick={() => window.electronAPI.windowMinimize()}>
          <Icon name="minimize" size={15} />
        </button>
        <button className="title-bar-button" type="button" title={t('最大化', 'Maximize / restore')} onClick={() => window.electronAPI.windowMaximize()}>
          <Icon name="maximize" size={13} />
        </button>
        <button className="title-bar-button close-window" type="button" title={t('关闭', 'Close')} onClick={() => window.electronAPI.windowClose()}>
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>
  )
}
