import type { SettingsTriggerProps } from '../ui/settings-trigger'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsTrigger } from '../ui/settings-trigger'
import { registerSettings } from './settings'

const calls = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('dsh-tauri/client', async () => ({
  ...await import('../../../../dsh-tauri/src/client/register'),
  ...await import('../../../../dsh-tauri/src/client/utils/device'),
  invoke: calls.invoke,
}))
vi.mock('@deepseek-ai/dsh-client-ui-renderer', () => ({ SlotOutlet: () => null }))
vi.mock('../ui/settings-sidebar', () => ({ SettingsSidebar: () => null }))
vi.mock('../ui/settings-trigger', () => ({ SettingsTrigger: () => null }))
vi.mock('../store', () => ({ store: { settings: { setLauncherShortcut: vi.fn() } } }))

const disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0))
    dispose()
  calls.invoke.mockReset()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function register() {
  let account: Pick<SettingsTriggerProps, 'getEmployee' | 'signOut'> = {}
  const slots = {
    inject(_key: string, callback: () => () => void) { return callback() },
    register(options: { inject?: () => unknown }, component: unknown) {
      if (component === SettingsTrigger)
        account = options.inject!() as typeof account
      return () => {}
    },
  }
  const ctx = { slots, effect: (callback: () => () => void) => callback() }
  const dispose = registerSettings.call(ctx)
  disposers.push(dispose)
  return account
}

describe('设置菜单账号动作装配', () => {
  it('桌面环境使用扫码登录的个人信息及退出命令', async () => {
    vi.stubGlobal('dshDesktop', {})
    const employee = { employeeNumber: 'TD000001', employeeName: '张三' }
    calls.invoke.mockResolvedValueOnce(employee).mockResolvedValueOnce(undefined)
    const account = register()
    expect(account.getEmployee).toBeTypeOf('function')
    expect(account.signOut).toBeTypeOf('function')
    await expect(account.getEmployee!()).resolves.toEqual(employee)
    await account.signOut!()
    expect(calls.invoke.mock.calls).toEqual([['desktop_auth_employee'], ['desktop_auth_logout']])
  })

  it('独立浏览器环境不装配桌面账号操作', () => {
    expect(register()).toEqual({})
    expect(calls.invoke).not.toHaveBeenCalled()
  })
})
