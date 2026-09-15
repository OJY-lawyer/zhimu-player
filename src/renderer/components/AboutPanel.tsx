import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons'
import { useI18n } from '../i18n'
import '../styles/about.css'
import { APP_NAME_ZH, APP_NAME_EN } from '../../shared/brand'
import { UpdatePanel } from './UpdatePanel'

declare const __APP_VERSION__: string

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.0.0'
const APP_ICON = new URL('../../../assets/app-icon.png', import.meta.url).href
const AUTHOR_WECHAT = new URL('../../../assets/about/author-wechat-original.png', import.meta.url).href
const DONATION_ORIGINAL = new URL('../../../assets/about/donation-original.png', import.meta.url).href
const SUPPORT_FRAME = new URL('../../../assets/about/support-frame.png', import.meta.url).href

type AboutTab = 'contact' | 'support'

function SupportPoster() {
  const { language, t } = useI18n()
  return (
    <div className="about-support-poster" lang={language} data-export="support-poster">
      <img className="about-support-art" src={SUPPORT_FRAME} alt="" draggable={false} />
      <div className="about-support-heading">
        <span>{t('支持独立开发', 'SUPPORT INDEPENDENT DEVELOPMENT')}</span>
        <h3>{t('赞助一点 Token', 'Sponsor a few tokens')}</h3>
        <p>{t('让好用的工具，继续打磨。', 'Keep useful tools improving.')}</p>
      </div>
      <div className="about-payment-code">
        <div className="about-donation-crop">
          <img
            src={DONATION_ORIGINAL}
            alt={t('欧俊言律师的微信收款二维码，使用原图中的二维码区域', 'Original WeChat payment QR code for Ou Junyan, Attorney')}
            draggable={false}
          />
        </div>
      </div>
      <div className="about-support-signature">
        <strong>{t('欧俊言律师', 'Ou Junyan, Attorney')}</strong>
        <span>{t('微信扫码 · 自愿支持', 'Scan with WeChat · Voluntary support')}</span>
      </div>
      <p className="about-poster-footnote">{t('感谢每一份支持', 'Thank you for every contribution')}</p>
    </div>
  )
}

export function AboutPanel({ onClose }: { onClose: () => void }) {
  const { language, t } = useI18n()
  const [tab, setTab] = useState<AboutTab>('contact')
  const [expanded, setExpanded] = useState<AboutTab | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const contactTabRef = useRef<HTMLButtonElement>(null)
  const supportTabRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => { previous?.focus() }
  }, [])

  useEffect(() => { closeRef.current?.focus() }, [expanded])

  const switchTab = (next: AboutTab) => {
    setTab(next)
    setExpanded(null)
    if (next === 'contact') contactTabRef.current?.focus()
    else supportTabRef.current?.focus()
  }

  return (
    <div className="about-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div
        className={'about-dialog' + (expanded ? ' has-expanded-image' : '')}
        ref={dialogRef}
        lang={language}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') {
            event.preventDefault()
            if (expanded) setExpanded(null)
            else onClose()
          }
          if (event.key === 'Tab') {
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea, [tabindex="0"]') || [])
              .filter((control) => control.tabIndex >= 0 && control.getClientRects().length > 0)
            const first = controls[0]
            const last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }
        }}
      >
        <header className="about-header">
          <div className="about-product-name">
            <img src={APP_ICON} alt="" />
            <div><strong id="about-dialog-title">{t(APP_NAME_ZH, APP_NAME_EN)}</strong><span>{t('版本', 'Version')} {APP_VERSION}{APP_VERSION.includes('-') ? t(' · 拟发布版', ' · Release candidate') : ''}</span></div>
          </div>
          <button ref={closeRef} className="icon-button" type="button" aria-label={t('关闭关于', 'Close about')} onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        {expanded ? (
          <div className="about-expanded-view">
            <button className="text-button about-return" type="button" onClick={() => setExpanded(null)}>
              <Icon name="chevron-left" size={15} />{t('返回关于', 'Back to about')}
            </button>
            {expanded === 'contact' ? (
              <img className="about-wechat-full" src={AUTHOR_WECHAT} alt={t('OJY 的完整微信联系二维码原图', 'Original WeChat contact QR image for OJY')} />
            ) : <SupportPoster />}
          </div>
        ) : (
          <div className="about-body">
            <section className="about-author-copy">
              <span className="about-eyebrow">{t('关于作者', 'ABOUT THE AUTHOR')}</span>
              <h2>{t('欧俊言律师', 'Ou Junyan, Attorney')}</h2>
              <p className="about-introduction">{t('把长录像变成', 'Make long recordings')}<br />{t('可以定位、回看的内容。', 'easy to find your way through.')}</p>
              <p className="about-description">{t('本地播放、字幕修订、AI 导读。让看课与回看直播更顺手，也让人工修改始终方便。', 'Local playback, subtitle editing and AI guides. Navigate courses and recorded streams with less effort, and keep your own edits within reach.')}</p>
              <div className="about-license-note">
                <strong>{t('免费使用 · 保留署名', 'Free to use · Attribution required')}</strong>
                <p>{t('允许日常工作免费使用；禁止售卖、对外收费部署和商业集成。分发时请保留“欧俊言律师”署名及许可全文。', 'Free use in everyday work is allowed. Selling the software, paid deployment for others and commercial integration are prohibited without separate written permission. When redistributing, retain the attribution “欧俊言律师” and the full license.')}</p>
                <small>{t('完整条款见随附的 LICENSE 与 NOTICE。', 'See the included LICENSE and NOTICE for full terms.')}</small>
              </div>
            </section>

            <section className="about-connection">
              <div className="about-tabs" role="tablist" aria-label={t('作者联系与支持', 'Contact and support the author')}>
                <button
                  ref={contactTabRef}
                  id="about-contact-tab"
                  role="tab"
                  type="button"
                  aria-selected={tab === 'contact'}
                  aria-controls="about-connection-panel"
                  tabIndex={tab === 'contact' ? 0 : -1}
                  onClick={() => switchTab('contact')}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                      event.preventDefault()
                      switchTab('support')
                    }
                  }}
                >{t('联系作者', 'Contact')}</button>
                <button
                  ref={supportTabRef}
                  id="about-support-tab"
                  role="tab"
                  type="button"
                  aria-selected={tab === 'support'}
                  aria-controls="about-connection-panel"
                  tabIndex={tab === 'support' ? 0 : -1}
                  onClick={() => switchTab('support')}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                      event.preventDefault()
                      switchTab('contact')
                    }
                  }}
                >{t('支持开发', 'Support development')}</button>
              </div>
              <div
                id="about-connection-panel"
                className="about-connection-content"
                role="tabpanel"
                aria-labelledby={tab === 'contact' ? 'about-contact-tab' : 'about-support-tab'}
              >
                {tab === 'contact' ? (
                  <>
                    <button className="about-contact-card" type="button" onClick={() => setExpanded('contact')} aria-label={t('放大查看作者微信二维码原图', 'Enlarge the original WeChat contact QR image')}>
                      <img src={AUTHOR_WECHAT} alt={t('OJY 微信二维码', 'WeChat contact QR code for OJY')} draggable={false} />
                    </button>
                    <p className="about-image-caption">{t('微信扫码交流 · 点击图片可放大', 'Scan with WeChat to connect · Click to enlarge')}</p>
                  </>
                ) : (
                  <>
                    <button className="about-support-button" type="button" onClick={() => setExpanded('support')} aria-label={t('放大查看自愿赞助收款码', 'Enlarge the voluntary support payment QR code')}>
                      <SupportPoster />
                    </button>
                    <p className="about-image-caption">{t('点击图片可放大', 'Click to enlarge')}</p>
                  </>
                )}
              </div>
            </section>
          </div>
        )}

        {!expanded && <UpdatePanel />}
        <footer className="about-footer">
          {tab === 'support' || expanded === 'support'
            ? t('赞助完全自愿，不影响功能使用，也不授予商业许可或其他特权。', 'Support is voluntary. It does not affect access to features or grant a commercial license or other privileges.')
            : '© 2026 欧俊言律师 · ' + t(APP_NAME_ZH, APP_NAME_EN)}
        </footer>
      </div>
    </div>
  )
}
