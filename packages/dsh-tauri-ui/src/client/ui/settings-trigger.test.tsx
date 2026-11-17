// @vitest-environment jsdom
import type { SessionListStateLike } from './settings-trigger'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { store } from '../store'
import { SettingsTrigger } from './settings-trigger'

vi.mock('dsh-tauri/client', async () => ({
  ...await import('../../../../dsh-tauri/src/client/modules/reause'),
  ...await import('../../../../dsh-tauri/src/client/modules/valtio-define'),
  ...await import('../../../../dsh-tauri/src/client/modules/lodash-es'),
  ...await import('../../../../dsh-tauri/src/client/modules/tailwind-variants'),
}))
vi.mock('../locales', () => ({ locale: { useLocale: () => 'zh', text: (key: string) => key } }))
vi.mock('../store', async () => {
  const { defineStore } = await import('valtio-define')
  return { store: {
    settings: defineStore({ state: () => ({ open: false, launcherShortcut: undefined }), actions: { openAt() { this.open = true } } }),
    sections: defineStore({ state: () => ({ onboarding: [] }) }),
  } }
})
vi.mock('../components/official', () => ({
  SlotOutlet: ({ slotKey }: { slotKey: string }) => <span>{slotKey}</span>,
}))

const employee = { employeeNumber: 'TD000001', employeeName: '张三' }

function selectSessions<T>(select: (state: SessionListStateLike) => T): T {
  return select({ phase: 'ready', byId: {}, ids: [] } as unknown as SessionListStateLike)
}

beforeEach(() => {
  store.settings.open = false
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('侧栏账号与快捷操作', () => {
  it('进入主页即展示姓名，设置和退出图标按顺序放在同一行', async () => {
    const getEmployee = vi.fn().mockResolvedValue(employee)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={getEmployee} signOut={vi.fn()} />)
    const row = await screen.findByRole('group', { name: '张三' })
    expect(row.textContent).toBe('张三')
    const buttons = within(row).getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['settings', 'logout'])
    expect(buttons.map(button => button.textContent)).toEqual(['', ''])
    expect(screen.queryByRole('button', { name: '张三' })).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByText('TD000001')).toBeNull()
    expect(screen.queryByText('more')).toBeNull()
    expect(getEmployee).toHaveBeenCalledTimes(1)
  })

  it('窄侧栏隐藏姓名文字，设置和退出图标仍可操作', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(<SettingsTrigger wide={false} useSessions={selectSessions} getEmployee={vi.fn().mockResolvedValue(employee)} signOut={signOut} />)
    const row = await screen.findByRole('group', { name: '张三' })
    expect(row.textContent).toBe('')
    expect(row.querySelector('[title="张三"] svg')).not.toBeNull()
    expect(within(row).getByRole('button', { name: 'logout' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(within(row).getByRole('button', { name: 'settings' }))
    expect(store.settings.open).toBe(true)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('个人信息失败可重试且仍允许退出登录', async () => {
    const getEmployee = vi.fn().mockRejectedValueOnce(new Error('DESKTOP_AUTH_NETWORK')).mockResolvedValue(employee)
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={getEmployee} signOut={signOut} />)
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'logout' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    const row = await screen.findByRole('group', { name: '张三' })
    expect(row.textContent).toBe('张三')
    expect(screen.queryByText('TD000001')).toBeNull()
    expect(getEmployee).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('点击退出图标调用退出，失败保留姓名供重试，成功清除姓名', async () => {
    const getEmployee = vi.fn().mockResolvedValue(employee)
    const signOut = vi.fn().mockRejectedValueOnce(new Error('DESKTOP_AUTH_VAULT_UNAVAILABLE')).mockResolvedValue(undefined)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={getEmployee} signOut={signOut} />)
    await screen.findByRole('group', { name: '张三' })
    fireEvent.click(screen.getByRole('button', { name: 'logout' }))
    await screen.findByText('logoutFailed')
    expect(screen.getByRole('group', { name: '张三' }).textContent).toContain('张三')
    expect(store.settings.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'logout' }))
    await screen.findByRole('group', { name: 'account' })
    expect(screen.queryByText('张三')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(signOut).toHaveBeenCalledTimes(2)
  })

  it('退出请求进行中禁用退出图标，避免重复提交', async () => {
    let finishSignOut!: () => void
    const pending = new Promise<void>((resolve) => {
      finishSignOut = resolve
    })
    const signOut = vi.fn().mockReturnValue(pending)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={vi.fn().mockResolvedValue(employee)} signOut={signOut} />)
    await screen.findByRole('group', { name: '张三' })
    const logout = screen.getByRole('button', { name: 'logout' })
    fireEvent.click(logout)
    await waitFor(() => expect(logout.hasAttribute('disabled')).toBe(true))
    fireEvent.click(logout)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'settings' }).hasAttribute('disabled')).toBe(false)
    await act(async () => finishSignOut())
    await screen.findByRole('group', { name: 'account' })
    expect(logout.hasAttribute('disabled')).toBe(false)
  })

  it('点击设置图标直接打开设置内容，不弹出菜单', async () => {
    render(<SettingsTrigger wide useSessions={selectSessions} />)
    const settings = screen.getByRole('button', { name: 'settings' })
    expect(settings.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(settings)
    expect(store.settings.open).toBe(true)
    await waitFor(() => expect(settings.getAttribute('aria-expanded')).toBe('true'))
    expect(settings.getAttribute('data-settings-trigger')).toBe('dsh-tauri-ui')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('未提供退出能力时禁用退出图标', () => {
    render(<SettingsTrigger wide useSessions={selectSessions} />)
    expect(screen.getByRole('button', { name: 'logout' }).hasAttribute('disabled')).toBe(true)
  })
})
