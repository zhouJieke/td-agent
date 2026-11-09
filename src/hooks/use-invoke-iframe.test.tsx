// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth } from '@/store/modules/auth'
import { useInvokeIframe } from './use-invoke-iframe'

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  receive: undefined as undefined | ((data: { type: string, cmd: string, nonce: string, args?: Record<string, unknown> }, context: { origin: string }) => void),
}))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: bridge.invoke }))
vi.mock('@/hooks/use-iframe-message', () => ({ useIframeMessage: (_ref: unknown, receive: typeof bridge.receive) => {
  bridge.receive = receive
} }))

beforeEach(() => {
  bridge.invoke.mockReset()
  bridge.receive = undefined
  auth.session = null
  auth.ticket = null
  auth.expired = false
  auth.logoutId = 0
})

afterEach(() => {
  auth.session = null
  vi.restoreAllMocks()
})

function mount() {
  const postMessage = vi.fn()
  const ref = { current: { contentWindow: { postMessage } } as unknown as HTMLIFrameElement }
  renderHook(() => useInvokeIframe(ref))
  expect(bridge.receive).toBeTypeOf('function')
  return postMessage
}

describe('设置账号命令桥', () => {
  it('个人信息命令使用固定 Rust 接口，忽略帧传入的路径参数', async () => {
    const employee = { employeeNumber: 'TD000001', employeeName: '张三' }
    bridge.invoke.mockResolvedValue(employee)
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_employee', nonce: 'profile', args: { path: '/api/private', token: 'ignored' } }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'profile', ok: true, value: employee }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke.mock.calls).toEqual([['desktop_auth_employee']])
  })

  it('设置菜单退出命令清除壳层员工会话', async () => {
    bridge.invoke.mockResolvedValue(10)
    auth.session = { employeeNumber: 'TD000001', employeeName: '张三', expiresAt: 1800000000000 }
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_logout', nonce: 'logout' }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'logout', ok: true, value: undefined }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledWith('desktop_auth_logout')
    expect(auth.session).toBeNull()
  })

  it('鉴权业务请求命令按原参数转发给 Rust 并回传信封', async () => {
    const envelope = { code: 0, msg: null, data: true }
    bridge.invoke.mockResolvedValue(envelope)
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_request', nonce: 'save', args: { method: 'POST', path: '/api/employee-skills/user/TD000001', body: { skillNames: ['skill-a'] } } }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'save', ok: true, value: envelope }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledWith('desktop_auth_request', { method: 'POST', path: '/api/employee-skills/user/TD000001', body: { skillNames: ['skill-a'] } })
  })

  it('请求命令缺省方法与载荷时按 GET 空体转发', async () => {
    bridge.invoke.mockResolvedValue({ code: 0, msg: null, data: null })
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_request', nonce: 'list', args: { path: '/api/employee-skills/common' } }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'list', ok: true, value: { code: 0, msg: null, data: null } }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledWith('desktop_auth_request', { method: 'GET', path: '/api/employee-skills/common', body: null })
  })

  it('上传命令按原参数转发给 Rust 并回传信封', async () => {
    const envelope = { code: 0, msg: null, data: { skillName: 'demo', version: '1.0.0' } }
    bridge.invoke.mockResolvedValue(envelope)
    const postMessage = mount()
    const args = { path: '/api/employee-skills/upload', fileName: 'demo.zip', contentType: 'application/zip', body: [1, 2, 3] }
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_upload', nonce: 'upload', args }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'upload', ok: true, value: envelope }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledWith('desktop_auth_upload', args)
  })

  it('安装技能命令只转发技能名并回传结果', async () => {
    bridge.invoke.mockResolvedValue(undefined)
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_install_employee_skill', nonce: 'skill', args: { skillName: 'demo', path: 'ignored', body: 'ignored' } }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'skill', ok: true, value: undefined }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_install_employee_skill', { skillName: 'demo' })
  })

  it('安装技能命令拒绝非字符串名称', async () => {
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_install_employee_skill', nonce: 'invalid', args: { skillName: 123 } }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'invalid', ok: false, error: 'SKILL_NAME_INVALID' }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).not.toHaveBeenCalled()
  })

  it('技能更新命令只转发名称和版本并回传实际版本', async () => {
    bridge.invoke.mockResolvedValue('1.1.0')
    const postMessage = mount()
    bridge.receive!({
      type: 'dsh://tauri:invoke',
      cmd: 'desktop_update_employee_skill',
      nonce: 'update',
      args: { skillName: 'demo', expectedVersion: '1.1.0', installedVersion: '1.0.0', path: 'ignored' },
    }, { origin: 'http://127.0.0.1:3081' })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: 'dsh://tauri:reply', nonce: 'update', ok: true, value: '1.1.0' },
      'http://127.0.0.1:3081',
    ))
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_update_employee_skill', {
      skillName: 'demo',
      expectedVersion: '1.1.0',
      installedVersion: '1.0.0',
    })
  })

  it('确认覆盖旧技能时保留未知的已安装版本', async () => {
    bridge.invoke.mockResolvedValue('1.1.0')
    const postMessage = mount()
    bridge.receive!({
      type: 'dsh://tauri:invoke',
      cmd: 'desktop_update_employee_skill',
      nonce: 'update-legacy',
      args: { skillName: 'demo', expectedVersion: '1.1.0', installedVersion: null },
    }, { origin: 'http://127.0.0.1:3081' })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: 'dsh://tauri:reply', nonce: 'update-legacy', ok: true, value: '1.1.0' },
      'http://127.0.0.1:3081',
    ))
    expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('desktop_update_employee_skill', {
      skillName: 'demo',
      expectedVersion: '1.1.0',
      installedVersion: null,
    })
  })

  it.each([
    { skillName: 'demo', expectedVersion: 123, installedVersion: null },
    { skillName: 'demo', expectedVersion: '1.1.0' },
    { skillName: 'demo', expectedVersion: '1.1.0', installedVersion: false },
  ])('技能更新命令拒绝无效参数 %j', async (args) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_update_employee_skill', nonce: 'invalid-update', args }, { origin: 'http://127.0.0.1:3081' })

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: 'dsh://tauri:reply', nonce: 'invalid-update', ok: false, error: 'SKILL_UPDATE_REQUEST_INVALID' },
      'http://127.0.0.1:3081',
    ))
    expect(bridge.invoke).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledOnce()
  })

  it('访问令牌命令放行给帧内，供插件直连外部业务后端自附 Bearer', async () => {
    bridge.invoke.mockResolvedValue('access-token')
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_access_token', nonce: 'token' }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'token', ok: true, value: 'access-token' }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledWith('desktop_auth_access_token', undefined)
  })
})
