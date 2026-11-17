import type { EmployeeInfo } from 'dsh-tauri/client'
import { invoke } from 'dsh-tauri/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { store } from '../store'
import { fetchAuth } from './auth'

vi.mock('dsh-tauri/client', async importOriginal => ({
  ...await importOriginal<typeof import('dsh-tauri/client')>(),
  invoke: vi.fn(),
}))

const employee: EmployeeInfo = { employeeNumber: 'E1', employeeName: 'Employee' }

beforeEach(() => {
  store.skill.setTab('enterprise')
  store.skill.setEmployee(employee)
  vi.mocked(invoke).mockReset()
})

afterEach(() => vi.restoreAllMocks())

describe('技能中心登录态探测', () => {
  it('较早的登录成功响应不能覆盖较新的未登录状态', async () => {
    let resolveOld!: (value: EmployeeInfo) => void
    const old = new Promise<EmployeeInfo>((resolve) => {
      resolveOld = resolve
    })
    vi.mocked(invoke).mockReturnValueOnce(old).mockRejectedValueOnce(new Error('session expired'))

    const first = fetchAuth()
    const second = fetchAuth()
    expect(store.skill.authChecked).toBe(false)
    await expect(second).resolves.toBe(true)
    resolveOld(employee)

    await expect(first).resolves.toBe(false)
    expect(store.skill.employee).toBeNull()
    expect(store.skill.authChecked).toBe(true)
  })
})
