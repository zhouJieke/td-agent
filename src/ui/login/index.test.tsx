// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import QRCode from 'qrcode'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth } from '@/store/modules/auth'
import { toast } from '@/utils/toast'
import { DesktopEntry, Login } from './index'

const ipc = vi.hoisted(() => ({ native: true, invoke: vi.fn(), loggedOut: undefined as undefined | ((event: { payload: number }) => void) }))
const appRender = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => ipc.native, invoke: ipc.invoke }))
vi.mock('@/hooks/use-listen', () => ({ useListen: (event: string, handler: (event: { payload: number }) => void) => {
  if (event === 'desktop-auth-logged-out')
    ipc.loggedOut = handler
} }))
vi.mock('@/layout', () => ({ App: () => {
  appRender()
  return <div data-testid="running-harness" />
} }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'zh-CN', changeLanguage: vi.fn() } }),
}))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))

const clients: QueryClient[] = []
const session = { employeeNumber: 'TD000001', employeeName: '张三', expiresAt: 1800000000000 }
const qr = { loginId: 1, authUrl: 'https://login.dingtalk.com/oauth2/auth?state=one&client_id=desktop' }
const wecomQr = { loginId: 2, authUrl: 'https://login.work.weixin.qq.com/wwlogin/sso/login?login_type=CorpApp&appid=ww1&agentid=100&state=two&redirect_uri=https%3A%2F%2Fbcw-test.jinmit.com%2Fdesktop%2Fcb' }

function renderPage(children: ReactNode = <Login onContinue={vi.fn()} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

beforeEach(() => {
  ipc.native = true
  auth.session = null
  auth.ticket = null
  auth.expired = false
  auth.logoutId = 0
  ipc.loggedOut = undefined
  ipc.invoke.mockReset()
  ipc.invoke.mockImplementation(async (command) => {
    if (command === 'desktop_auth_begin')
      return qr
    if (command === 'desktop_auth_claim')
      return { status: 'pending' }
    return null
  })
})

afterEach(async () => {
  cleanup()
  await auth.cancel()
  for (const client of clients.splice(0))
    client.clear()
  auth.session = null
  appRender.mockClear()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(toast).mockClear()
})

describe('桌面钉钉扫码登录', () => {
  it.each(['authenticated', 'local'])('退出 %s 工作台后清除个人信息并回到扫码页', async (mode) => {
    let saved = mode === 'authenticated' ? session : null
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_session')
        return saved
      if (command === 'desktop_auth_begin')
        return qr
      return null
    })
    renderPage(<DesktopEntry />)
    if (mode === 'local') {
      await screen.findByRole('img', { name: 'login.qr_alt' })
      fireEvent.click(screen.getByRole('button', { name: 'login.continue_local' }))
    }
    await screen.findByTestId('running-harness')
    saved = null
    expect(ipc.loggedOut).toBeTypeOf('function')
    act(() => ipc.loggedOut!({ payload: 10 }))
    await screen.findByRole('img', { name: 'login.qr_alt' })
    expect(screen.queryByTestId('running-harness')).toBeNull()
    expect(auth.session).toBeNull()
    expect(auth.logoutId).toBe(10)
  })

  it('企微用 qrcode 原样编码后端 authUrl，不加载远程二维码页面', async () => {
    const encode = vi.spyOn(QRCode, 'toString')
    const fetch = vi.spyOn(globalThis, 'fetch')
    ipc.invoke.mockImplementation(async (command, args) => {
      if (command === 'desktop_auth_begin')
        return (args as { platform: string }).platform === 'wecom' ? wecomQr : qr
      if (command === 'desktop_auth_claim')
        return { status: 'pending' }
      return null
    })
    renderPage()
    const dingTalk = screen.getByRole('tab', { name: 'login.dingtalk' })
    const weCom = screen.getByRole('tab', { name: 'login.wecom' })
    await screen.findByRole('img', { name: 'login.qr_alt' })
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_begin', { platform: 'dingtalk' })
    fireEvent.click(weCom)
    expect(weCom.getAttribute('aria-selected')).toBe('true')
    expect(dingTalk.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('login-tab-wecom')
    await waitFor(() => expect(encode).toHaveBeenCalledWith(wecomQr.authUrl, expect.objectContaining({ type: 'svg', margin: 4, errorCorrectionLevel: 'M' })))
    const image = await screen.findByRole('img', { name: 'login.qr_alt' })
    expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(image.getAttribute('src')!)).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(screen.getByRole('tabpanel').querySelector('iframe')).toBeNull()
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_begin', { platform: 'wecom' })
    expect(fetch).not.toHaveBeenCalled()
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_open_login_window')).toHaveLength(0)
  })

  it('企微 begin 被拒绝时仍展示后端文案且不显示二维码', async () => {
    renderPage()
    await screen.findByRole('img', { name: 'login.qr_alt' })
    ipc.invoke.mockRejectedValueOnce('DESKTOP_AUTH_BEGIN_REJECTED: 企业微信登录未配置（hr.im.wecom），无法发起')
    fireEvent.click(screen.getByRole('tab', { name: 'login.wecom' }))
    await screen.findByText('企业微信登录未配置（hr.im.wecom），无法发起')
    expect(screen.queryByRole('img', { name: 'login.qr_alt' })).toBeNull()
  })

  it('企微重新获取二维码仍请求 wecom 票据并编码最新 authUrl', async () => {
    const encode = vi.spyOn(QRCode, 'toString')
    let id = 1
    ipc.invoke.mockImplementation(async (command, args) => {
      if (command === 'desktop_auth_begin') {
        if ((args as { platform: string }).platform === 'wecom') {
          id++
          return { loginId: id, authUrl: `${wecomQr.authUrl}&attempt=${id}` }
        }
        return qr
      }
      return null
    })
    renderPage()
    await screen.findByRole('img', { name: 'login.qr_alt' })
    fireEvent.click(screen.getByRole('tab', { name: 'login.wecom' }))
    await waitFor(() => expect(auth.ticket?.loginId).toBe(2))
    const first = await screen.findByRole('img', { name: 'login.qr_alt' })
    const source = first.getAttribute('src')
    fireEvent.click(screen.getByRole('button', { name: 'login.refresh_qr' }))
    await waitFor(() => expect(auth.ticket?.loginId).toBe(3))
    await waitFor(() => expect(encode).toHaveBeenCalledWith(`${wecomQr.authUrl}&attempt=3`, expect.objectContaining({ type: 'svg', margin: 4, errorCorrectionLevel: 'M' })))
    const refreshed = await screen.findByRole('img', { name: 'login.qr_alt' })
    expect(refreshed.getAttribute('src')).not.toBe(source)
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_begin').map(call => call[1])).toEqual([
      { platform: 'dingtalk' },
      { platform: 'wecom' },
      { platform: 'wecom' },
    ])
  })

  it('方向键和 Home End 切换平台时同步选中状态与键盘焦点', () => {
    ipc.native = false
    renderPage()
    const dingTalk = screen.getByRole('tab', { name: 'login.dingtalk' })
    const weCom = screen.getByRole('tab', { name: 'login.wecom' })
    fireEvent.keyDown(dingTalk, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(weCom)
    expect(weCom.getAttribute('aria-selected')).toBe('true')
    expect(weCom.tabIndex).toBe(0)
    expect(dingTalk.tabIndex).toBe(-1)
    fireEvent.keyDown(weCom, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(dingTalk)
    expect(dingTalk.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(dingTalk, { key: 'End' })
    expect(document.activeElement).toBe(weCom)
    fireEvent.keyDown(weCom, { key: 'Home' })
    expect(document.activeElement).toBe(dingTalk)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('login-tab-dingtalk')
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('企微自渲染二维码仍按两秒领取新票据并在成功后进入工作台', async () => {
    vi.useFakeTimers()
    ipc.invoke.mockImplementation(async (command, args) => {
      if (command === 'desktop_auth_begin')
        return (args as { platform: string }).platform === 'wecom' ? wecomQr : qr
      if (command === 'desktop_auth_claim')
        return { status: 'authenticated', session }
      return null
    })
    renderPage(<DesktopEntry />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    fireEvent.click(screen.getByRole('tab', { name: 'login.wecom' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByRole('img', { name: 'login.qr_alt' })).not.toBeNull()
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_claim')).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_claim')).toEqual([['desktop_auth_claim', { loginId: 2 }]])
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_open_login_window')).toHaveLength(0)
    expect(auth.session).toEqual(session)
    expect(screen.getByTestId('running-harness')).not.toBeNull()
  })

  it('使用真实 qrcode 库编码 authUrl，浏览器不发起登录网络请求', async () => {
    const encode = vi.spyOn(QRCode, 'toString')
    const fetch = vi.spyOn(globalThis, 'fetch')
    renderPage()
    const image = await screen.findByRole('img', { name: 'login.qr_alt' })
    expect(encode).toHaveBeenCalledWith(qr.authUrl, expect.objectContaining({ type: 'svg', margin: 4, errorCorrectionLevel: 'M' }))
    expect(decodeURIComponent(image.getAttribute('src')!)).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText('login.scan_waiting')).not.toBeNull()
  })

  it('浏览器环境显示桌面提示且不调用原生命令', async () => {
    ipc.native = false
    renderPage()
    expect(screen.getByText('login.desktop_required')).not.toBeNull()
    expect((screen.getByRole('button', { name: 'login.continue_local' }) as HTMLButtonElement).disabled).toBe(true)
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('缺失 authUrl 时显示后端字段提示，不显示替代二维码', async () => {
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_begin')
        throw new Error('DESKTOP_AUTH_AUTH_URL_MISSING')
      return null
    })
    renderPage()
    await screen.findByText('login.auth_url_missing')
    expect(screen.queryByRole('img', { name: 'login.qr_alt' })).toBeNull()
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_claim')).toHaveLength(0)
  })

  it('重新生成二维码时替换旧票据', async () => {
    renderPage()
    await screen.findByRole('img', { name: 'login.qr_alt' })
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_begin')
        return { loginId: 2, authUrl: 'https://login.dingtalk.com/oauth2/auth?state=two' }
      return null
    })
    fireEvent.click(screen.getByRole('button', { name: 'login.refresh_qr' }))
    await waitFor(() => expect(auth.ticket?.loginId).toBe(2))
    await screen.findByRole('img', { name: 'login.qr_alt' })
  })

  it('二维码每两秒领取结果，410 后提示并自动重新 begin', async () => {
    vi.useFakeTimers()
    let begins = 0
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_begin') {
        begins++
        return { ...qr, loginId: begins, authUrl: `${qr.authUrl}&attempt=${begins}` }
      }
      if (command === 'desktop_auth_claim' && begins === 1)
        return { status: 'expired' }
      if (command === 'desktop_auth_claim')
        return { status: 'pending' }
      return null
    })
    renderPage()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByRole('img', { name: 'login.qr_alt' })).not.toBeNull()
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_claim')).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(begins).toBe(2)
    expect(toast).toHaveBeenCalledWith('login.qr_expired', { variant: 'warning' })
    expect(auth.ticket?.loginId).toBe(2)
    expect(screen.getByRole('img', { name: 'login.qr_alt' })).not.toBeNull()
  })

  it('领取成功后使用员工信息进入工作台', async () => {
    vi.useFakeTimers()
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_begin')
        return qr
      if (command === 'desktop_auth_claim')
        return { status: 'authenticated', session }
      return null
    })
    renderPage(<DesktopEntry />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(appRender).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(screen.getByTestId('running-harness')).not.toBeNull()
    expect(auth.session).toEqual(session)
    expect(screen.queryByTestId('dsh-login-page')).toBeNull()
  })

  it('恢复 Rust 内存中的有效会话时直接进入工作台', async () => {
    ipc.invoke.mockImplementation(async command => command === 'desktop_auth_session' ? session : null)
    renderPage(<DesktopEntry />)
    await screen.findByTestId('running-harness')
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_begin')).toHaveLength(0)
  })

  it('进入本地工作台时取消未完成的扫码票据', async () => {
    renderPage(<DesktopEntry />)
    await screen.findByRole('img', { name: 'login.qr_alt' })
    fireEvent.click(screen.getByRole('button', { name: 'login.continue_local' }))
    await screen.findByTestId('running-harness')
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_cancel')
    expect(auth.ticket).toBeNull()
  })
  it('进入工作台后在 access token 到期前静默续期', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    let reads = 0
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_session') {
        reads++
        if (reads === 1)
          return { ...session, expiresAt: now + 60_000 }
        return { ...session, expiresAt: now + 7_200_000 }
      }
      return null
    })
    renderPage(<DesktopEntry />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByTestId('running-harness')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })
    expect(reads).toBe(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100)
    })
    expect(reads).toBe(2)
    expect(auth.session?.expiresAt).toBe(now + 7_200_000)
    expect(screen.getByTestId('running-harness')).not.toBeNull()
  })

  it('静默续期失效后退出企业工作台并重新显示二维码', async () => {
    vi.useFakeTimers()
    let reads = 0
    ipc.invoke.mockImplementation(async (command) => {
      if (command === 'desktop_auth_session') {
        reads++
        if (reads === 1)
          return { ...session, expiresAt: Date.now() + 20_000 }
        return null
      }
      if (command === 'desktop_auth_begin')
        return qr
      return null
    })
    renderPage(<DesktopEntry />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.getByTestId('running-harness')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(screen.queryByTestId('running-harness')).toBeNull()
    expect(screen.getByRole('img', { name: 'login.qr_alt' })).not.toBeNull()
    expect(auth.session).toBeNull()
  })

  it('凭据库读取失败时提供可重试提示', async () => {
    ipc.invoke.mockRejectedValueOnce('DESKTOP_AUTH_VAULT_UNAVAILABLE')
    renderPage()
    await screen.findByText('login.vault_failed')
    expect(ipc.invoke.mock.calls.filter(([name]) => name === 'desktop_auth_begin')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'login.refresh_qr' }))
    await screen.findByRole('img', { name: 'login.qr_alt' })
  })
})
