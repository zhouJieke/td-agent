import { ArrowRight, ArrowRotateRight, CircleQuestion, Lock, Minus, ShieldCheck, Square, Xmark } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { useTimeoutFn } from '@reause/core'
import { useMutation } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { tv } from 'tailwind-variants'
import { toast } from '@/utils/toast'
import './login.css'

const providerStyles = tv({
  slots: {
    tab: 'login-provider',
    mark: 'login-provider-mark',
  },
  variants: {
    selected: { true: { tab: 'login-provider-selected' } },
  },
})

const providers = ['dingtalk', 'wecom'] as const
type Provider = typeof providers[number]
const App = lazy(async () => ({ default: (await import('@/layout')).App }))

export function DesktopEntry() {
  const { t } = useTranslation()
  const [localMode, setLocalMode] = useState(false)

  return (
    <If cond={localMode} else={<Login onContinue={() => setLocalMode(true)} />}>
      <Suspense fallback={(
        <div className="grid h-screen place-items-center bg-startup" role="status" aria-label={t('status.loading_plugins')}>
          <span className="h-5 w-5 animate-load-spin rounded-full border-2 border-load-ring border-t-load-ink" />
        </div>
      )}
      >
        <App />
      </Suspense>
    </If>
  )
}

export function Login({ onContinue }: { onContinue: () => void }) {
  const { t, i18n } = useTranslation()
  const [provider, setProvider] = useState<Provider>('dingtalk')
  const [revision, setRevision] = useState(0)
  const [expired, setExpired] = useState(false)
  const { start: restartExpiry } = useTimeoutFn(() => setExpired(true), 180_000)
  const providerName = t(`login.${provider}`)
  const native = isTauri()
  const qrSource = `/login/${provider}-preview-${revision % 2}.svg`
  const language = i18n.resolvedLanguage ?? 'zh-CN'
  const showWindowControls = native && !navigator.userAgent.includes('Macintosh')
  const { mutate: handleWindowAction } = useMutation({
    mutationFn: async (action: 'minimize' | 'toggleMaximize' | 'close') => getCurrentWindow()[action](),
    onError: () => toast(t('login.window_action_failed'), { variant: 'danger' }),
  })

  function refreshCode(nextProvider: Provider = provider) {
    setProvider(nextProvider)
    setRevision(value => value + 1)
    setExpired(false)
    restartExpiry()
  }

  return (
    <main className="login-page" data-testid="dsh-login-page">
      <If cond={native}><div className="login-drag-region" data-tauri-drag-region aria-hidden="true" /></If>
      <If cond={showWindowControls}>
        <div className="login-window-controls">
          <button type="button" aria-label={t('login.minimize')} onClick={() => handleWindowAction('minimize')}><Minus width="13" height="13" /></button>
          <button type="button" aria-label={t('login.maximize')} onClick={() => handleWindowAction('toggleMaximize')}><Square width="12" height="12" /></button>
          <button type="button" aria-label={t('login.close')} onClick={() => handleWindowAction('close')}><Xmark width="14" height="14" /></button>
        </div>
      </If>
      <header className="login-header">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <span>HARNESS</span>
          <span className="login-desktop-label">{t('login.desktop')}</span>
        </div>
        <div className="login-header-actions">
          <select
            className="login-language"
            aria-label={t('login.language')}
            value={language}
            onChange={event => void i18n.changeLanguage(event.target.value)}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en-US">English</option>
          </select>
          <details className="login-help">
            <summary aria-label={t('login.help')} title={t('login.help')}>
              <CircleQuestion width="19" height="19" />
            </summary>
            <div className="login-help-content">
              <strong>{t('login.help')}</strong>
              <p>{t('login.help_description')}</p>
            </div>
          </details>
        </div>
      </header>

      <div className="login-content">
        <section className="login-intro" aria-labelledby="login-intro-title">
          <span className="login-eyebrow">
            <span />
            {t('login.workspace')}
          </span>
          <h1 id="login-intro-title">
            {t('login.intro_title')}
            <br />
            <span>{t('login.intro_accent')}</span>
          </h1>
          <p className="login-intro-description">{t('login.intro_description')}</p>

          <div className="login-workspace-preview" aria-hidden="true">
            <div className="login-preview-titlebar">
              <span className="login-preview-dots">
                <i />
                <i />
                <i />
              </span>
              <span>HARNESS</span>
              <span className="login-preview-online">
                <span />
                {t('login.preview_local')}
              </span>
            </div>
            <div className="login-preview-body">
              <div className="login-preview-sidebar">
                <div className="login-preview-new">
                  +
                  <span>{t('login.preview_new')}</span>
                </div>
                <span className="login-preview-section">{t('login.preview_workspace')}</span>
                <div className="login-preview-project">
                  <span className="login-folder" />
                  {t('login.preview_project')}
                </div>
                <span className="login-preview-line" />
                <span className="login-preview-line login-preview-line-short" />
                <span className="login-preview-sidebar-bottom">
                  <span />
                  {t('login.preview_personal')}
                </span>
              </div>
              <div className="login-preview-conversation">
                <span className="login-preview-greeting">{t('login.preview_greeting')}</span>
                <div className="login-preview-prompt">{t('login.preview_prompt')}</div>
                <div className="login-preview-response">
                  <img src="/favicon.svg" alt="" width="22" height="22" />
                  <div>
                    <strong>{t('login.preview_reply')}</strong>
                    <span className="login-preview-line" />
                    <span className="login-preview-line login-preview-line-short" />
                  </div>
                </div>
                <div className="login-preview-file">
                  <span className="login-preview-file-icon">↗</span>
                  <span>
                    workspace
                    <small>{t('login.preview_ready')}</small>
                  </span>
                  <span className="login-preview-check">✓</span>
                </div>
                <div className="login-preview-composer">
                  <span>{t('login.preview_composer')}</span>
                  <span>↑</span>
                </div>
              </div>
            </div>
          </div>

          <div className="login-intro-footer">
            <ShieldCheck width="17" height="17" />
            <span>{t('login.local_description')}</span>
          </div>
        </section>

        <section className="login-auth" aria-labelledby="login-title">
          <div className="login-auth-heading">
            <h2 id="login-title">{t('login.title')}</h2>
            <p>{t('login.subtitle')}</p>
          </div>

          <div className="login-providers" role="tablist" aria-label={t('login.provider')}>
            {providers.map((item) => {
              const styles = providerStyles({ selected: provider === item })
              return (
                <button
                  key={item}
                  id={`login-tab-${item}`}
                  className={styles.tab()}
                  type="button"
                  role="tab"
                  aria-selected={provider === item}
                  aria-controls="login-qr-panel"
                  tabIndex={provider === item ? 0 : -1}
                  onClick={() => refreshCode(item)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                      return
                    event.preventDefault()
                    let next: Provider = 'dingtalk'
                    if (event.key === 'End' || (event.key !== 'Home' && provider === 'dingtalk'))
                      next = 'wecom'
                    refreshCode(next)
                    document.getElementById(`login-tab-${next}`)?.focus()
                  }}
                >
                  <span className={styles.mark()}><img src={`/login/${item}.svg`} alt="" width="20" height="20" /></span>
                  {t(`login.${item}`)}
                </button>
              )
            })}
          </div>

          <div className="login-qr-panel" id="login-qr-panel" role="tabpanel" aria-labelledby={`login-tab-${provider}`}>
            <div className="login-qr-frame" data-expired={expired}>
              <img className="login-qr-image" src={qrSource} alt={t('login.qr_alt', { provider: providerName })} width="208" height="208" />
              <span className="login-qr-brand" aria-hidden="true"><img src={`/login/${provider}.svg`} alt="" width="25" height="25" /></span>
              <If cond={expired}>
                <div className="login-qr-expired" role="status">
                  <ArrowRotateRight width="28" height="28" />
                  <strong>{t('login.expired')}</strong>
                  <Button size="sm" onPress={() => refreshCode()}>{t('login.refresh')}</Button>
                </div>
              </If>
            </div>
            <p className="login-scan-instruction">
              {t('login.scan_prefix')}
              <strong>{providerName}</strong>
              {t('login.scan_suffix')}
            </p>
            <p className="login-scan-description">{t('login.scan_description')}</p>
            <Button className="login-refresh" size="sm" variant="ghost" onPress={() => refreshCode()}>
              <ArrowRotateRight width="14" height="14" />
              {t('login.refresh')}
            </Button>
            <p className="login-preview-notice" role="status" aria-live="polite" key={`${provider}-${revision}`}>
              <If cond={revision > 0} else={t('login.preview_notice')}>{t('login.preview_refreshed')}</If>
            </p>
          </div>

          <div className="login-local-divider">
            <span />
            {t('login.or')}
            <span />
          </div>
          <Button className="login-local-button" variant="outline" onPress={onContinue} isDisabled={!native}>
            {t('login.continue_local')}
            <ArrowRight width="15" height="15" />
          </Button>
          <If cond={!native}><p className="login-browser-notice">{t('login.browser_notice')}</p></If>
          <div className="login-account-note">
            <Lock width="12" height="12" />
            <span>{t('login.account_note')}</span>
          </div>
        </section>
      </div>

      <footer className="login-footer">
        <span>{t('login.footer')}</span>
        <span>
          <span className="login-footer-dot" />
          {t('login.footer_status')}
        </span>
      </footer>
    </main>
  )
}
