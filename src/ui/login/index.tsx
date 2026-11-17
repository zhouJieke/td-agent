import { CircleQuestion, Minus, ShieldCheck, Square, Xmark } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { useIntervalFn, useUnmount, useWatch } from '@reause/core'
import { useMutation, useQuery } from '@tanstack/react-query'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import QRCode from 'qrcode'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { If } from 'react-if-lite'
import { tv } from 'tailwind-variants'
import { useStore } from 'valtio-define'
import { queryKeys } from '@/config/query-keys'
import { useListen } from '@/hooks/use-listen'
import { auth } from '@/store/modules/auth'
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
  const native = isTauri()
  const { session } = useStore(auth)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const { mutate: refreshSession, isPending: refreshing } = useMutation({ mutationFn: async () => auth.initialize(), retry: false })
  const renewal = useIntervalFn(() => {
    if (session && Date.now() >= session.expiresAt - 30_000 && !refreshing)
      refreshSession()
  }, 15_000, { immediate: false })
  const showWorkspace = workspaceReady && session !== null

  useListen<number>('desktop-auth-logged-out', ({ payload }) => {
    if (!Number.isSafeInteger(payload) || payload <= 0)
      return
    auth.completeLogout(payload)
    setWorkspaceReady(false)
  })

  useWatch([native, session !== null], () => {
    if (native && session)
      renewal.resume()
    else
      renewal.pause()
  }, { immediate: true })

  function continueToWorkspace() {
    setWorkspaceReady(auth.session !== null)
  }

  return (
    <If cond={showWorkspace} else={<Login onContinue={continueToWorkspace} />}>
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
  const native = isTauri()
  const { session, ticket, expired } = useStore(auth)
  const initialization = useQuery({
    queryKey: queryKeys.authSession,
    queryFn: async () => {
      await auth.initialize()
      return true
    },
    enabled: native,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const [provider, setProvider] = useState<Provider>('dingtalk')
  const qr = useQuery({
    queryKey: queryKeys.authQr(ticket?.loginId),
    queryFn: async () => {
      if (!ticket)
        throw new Error('DESKTOP_AUTH_SESSION_MISSING')
      const svg = await QRCode.toString(ticket.authUrl, { type: 'svg', margin: 4, errorCorrectionLevel: 'M' })
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    },
    enabled: ticket !== null,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const language = i18n.resolvedLanguage ?? 'zh-CN'
  const showWindowControls = native && !navigator.userAgent.includes('Macintosh')
  const authenticated = session !== null
  const { mutate: handleClaim, isPending: claiming, error: claimError, reset: resetClaim } = useMutation({
    mutationFn: async () => auth.claim(),
    retry: false,
  })
  const { mutate: handleBegin, isPending: beginning, error: beginError } = useMutation({
    mutationFn: (platform: Provider) => auth.begin(platform),
    onMutate: () => resetClaim(),
    retry: false,
  })
  const { mutate: handleWindowAction } = useMutation({
    mutationFn: async (action: 'minimize' | 'toggleMaximize' | 'close') => getCurrentWindow()[action](),
    onError: () => toast(t('login.window_action_failed'), { variant: 'danger' }),
  })

  function switchProvider(next: Provider) {
    setProvider(next)
    if (native && !authenticated && initialization.isSuccess && !initialization.isFetching)
      handleBegin(next)
  }
  const failure = initialization.error ?? beginError ?? claimError ?? qr.error
  let errorKey = 'login.scan_failed'
  if (String(failure).includes('DESKTOP_AUTH_AUTH_URL_MISSING'))
    errorKey = 'login.auth_url_missing'
  const vaultFailure = String(failure).includes('DESKTOP_AUTH_VAULT_')
  if (vaultFailure)
    errorKey = 'login.vault_failed'
  const rejection = String(failure).startsWith('DESKTOP_AUTH_BEGIN_REJECTED')
    ? String(failure).slice('DESKTOP_AUTH_BEGIN_REJECTED: '.length)
    : null
  const providerName = t(`login.${provider}`)
  const waiting = native && ticket !== null && qr.isSuccess && !failure && !expired && !authenticated
  const showQr = waiting && Boolean(qr.data)
  const loading = native && !failure && !expired && !authenticated && !showQr
  const poll = useIntervalFn(() => {
    if (waiting && !claiming)
      handleClaim()
  }, 2000, { immediate: false })

  useWatch([waiting], () => {
    if (waiting)
      poll.resume()
    else
      poll.pause()
  }, { immediate: true })
  useWatch([initialization.isSuccess, authenticated, native], () => {
    if (authenticated && native)
      onContinue()
    else if (native && initialization.isSuccess)
      handleBegin(provider)
  }, { immediate: true })
  useWatch([expired], () => {
    if (native && expired) {
      toast(t('login.qr_expired'), { variant: 'warning' })
      handleBegin(provider)
    }
  })
  useUnmount(() => {
    void auth.cancel().catch(error => console.error('[Login] cancel failed:', error))
  })

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
          <span>{t('app.name')}</span>
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
                  onClick={() => switchProvider(item)}
                  onKeyDown={(event) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
                      return
                    event.preventDefault()
                    let next: Provider = 'dingtalk'
                    if (event.key === 'End' || (event.key !== 'Home' && provider === 'dingtalk'))
                      next = 'wecom'
                    switchProvider(next)
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
            <div className="login-qr-area" aria-busy={loading}>
              <If cond={loading}><p role="status">{t('login.qr_loading')}</p></If>
              <If cond={showQr}>
                <img className="login-qr" src={qr.data} alt={t('login.qr_alt', { provider: providerName })} width="240" height="240" />
              </If>
              <If cond={Boolean(failure)}>
                <p role="alert">{rejection ?? t(errorKey)}</p>
              </If>
              <If cond={expired}><p role="status">{t('login.qr_expired')}</p></If>
              <If cond={!native}><p role="status">{t('login.desktop_required')}</p></If>
              <If cond={authenticated}><p role="status">{t('login.signed_in', { name: session?.employeeName, number: session?.employeeNumber })}</p></If>
            </div>
            <If cond={waiting}><p className="login-scan-description" role="status">{t('login.scan_waiting', { provider: providerName })}</p></If>
            <If cond={native && !authenticated}>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={beginning || initialization.isFetching}
                onPress={() => {
                  if (initialization.isError || vaultFailure)
                    void initialization.refetch()
                  else
                    handleBegin(provider)
                }}
              >
                {t('login.refresh_qr')}
              </Button>
            </If>
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
