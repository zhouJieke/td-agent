// @vitest-environment jsdom
import type { SessionListStateLike } from './settings-trigger'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
vi.mock('../components/official', async () => ({
  Menu: (await import('@deepseek-ai/dsh-client-ui-primitives')).Menu,
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

describe('设置菜单中的企业账号', () => {
  it('打开菜单才读取接口个人信息，工号姓名与退出按钮处于同一菜单', async () => {
    const getEmployee = vi.fn().mockResolvedValue(employee)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={getEmployee} signOut={vi.fn()} />)
    expect(getEmployee).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    await screen.findByText('张三')
    const menu = screen.getByRole('menu')
    expect(menu.contains(screen.getByText('TD000001'))).toBe(true)
    expect(menu.contains(screen.getByRole('menuitem', { name: 'logout' }))).toBe(true)
    expect(screen.queryByText('employeeName')).toBeNull()
    expect(screen.queryByText('employeeNumber')).toBeNull()
    expect(screen.queryByText('周先生')).toBeNull()
    expect(getEmployee).toHaveBeenCalledTimes(1)
  })

  it('个人信息失败可重试且仍允许退出登录', async () => {
    const getEmployee = vi.fn().mockRejectedValueOnce(new Error('DESKTOP_AUTH_NETWORK')).mockResolvedValue(employee)
    const signOut = vi.fn().mockResolvedValue(undefined)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={getEmployee} signOut={signOut} />)
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('menuitem', { name: 'logout' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'retry' }))
    await screen.findByText('TD000001')
    expect(getEmployee).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('退出失败保留菜单供重试，成功后清除个人信息并收起菜单', async () => {
    const getEmployee = vi.fn().mockResolvedValue(employee)
    const signOut = vi.fn().mockRejectedValueOnce(new Error('DESKTOP_AUTH_VAULT_UNAVAILABLE')).mockResolvedValue(undefined)
    render(<SettingsTrigger wide useSessions={selectSessions} getEmployee={getEmployee} signOut={signOut} />)
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    await screen.findByText('张三')
    fireEvent.click(screen.getByRole('menuitem', { name: 'logout' }))
    await screen.findByText('logoutFailed')
    expect(screen.getByText('TD000001')).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'logout' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.queryByText('张三')).toBeNull()
    expect(signOut).toHaveBeenCalledTimes(2)
  })

  it('用户可从同一菜单打开设置面板', () => {
    render(<SettingsTrigger wide useSessions={selectSessions} />)
    fireEvent.click(screen.getByRole('button', { name: 'more' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'settings' }))
    expect(store.settings.open).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
