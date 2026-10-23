// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopEntry, Login } from './index'

const runtime = vi.hoisted(() => ({ native: true }))
const appRender = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => runtime.native }))
vi.mock('@/layout', () => ({
  App: () => {
    appRender()
    return <div data-testid="running-harness" />
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'zh-CN', changeLanguage: vi.fn() },
  }),
}))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))

function renderPage(children: ReactNode = <Login onContinue={vi.fn()} />) {
  return render(<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>)
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  appRender.mockClear()
  runtime.native = true
})

describe('启动登录页', () => {
  it('选择本地模式之前不挂载工作台，选择后进入工作台', async () => {
    renderPage(<DesktopEntry />)
    expect(screen.getByTestId('dsh-login-page')).not.toBeNull()
    expect(appRender).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'login.continue_local' }))
    expect(screen.queryByTestId('dsh-login-page')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('running-harness')).not.toBeNull())
    expect(appRender).toHaveBeenCalled()
  })

  it('浏览器预览禁用本地模式，不调用桌面入口', () => {
    runtime.native = false
    const onContinue = vi.fn()
    renderPage(<Login onContinue={onContinue} />)
    const button = screen.getByRole('button', { name: 'login.continue_local' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onContinue).not.toHaveBeenCalled()
    expect(screen.getByText('login.browser_notice')).not.toBeNull()
  })

  it('切换企业微信后更新二维码与面板标签，方向键可以切回钉钉', () => {
    renderPage()
    const dingTalk = screen.getByRole('tab', { name: 'login.dingtalk' })
    const weCom = screen.getByRole('tab', { name: 'login.wecom' })
    expect(dingTalk.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(weCom)
    expect(weCom.getAttribute('aria-selected')).toBe('true')
    expect(dingTalk.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('login-tab-wecom')
    expect(screen.getByRole('img', { name: 'login.qr_alt' }).getAttribute('src')).toBe('/login/wecom-preview-1.svg')
    fireEvent.keyDown(weCom, { key: 'ArrowLeft' })
    expect(dingTalk.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(dingTalk)
  })

  it('刷新切换预览二维码并明确显示尚未连接认证服务', () => {
    renderPage()
    expect(screen.getByRole('img', { name: 'login.qr_alt' }).getAttribute('src')).toBe('/login/dingtalk-preview-0.svg')
    expect(screen.getByRole('status').textContent).toBe('login.preview_notice')
    fireEvent.click(screen.getByRole('button', { name: 'login.refresh' }))
    expect(screen.getByRole('img', { name: 'login.qr_alt' }).getAttribute('src')).toBe('/login/dingtalk-preview-1.svg')
    expect(screen.getByRole('status').textContent).toBe('login.preview_refreshed')
  })

  it('二维码三分钟后过期，刷新后重新计时', () => {
    vi.useFakeTimers()
    renderPage()
    act(() => vi.advanceTimersByTime(179_999))
    expect(screen.queryByText('login.expired')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('login.expired')).not.toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'login.refresh' })[0])
    expect(screen.queryByText('login.expired')).toBeNull()
    act(() => vi.advanceTimersByTime(179_999))
    expect(screen.queryByText('login.expired')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText('login.expired')).not.toBeNull()
  })
})
