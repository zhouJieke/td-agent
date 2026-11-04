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

  it('访问令牌命令放行给帧内，供插件直连外部业务后端自附 Bearer', async () => {
    bridge.invoke.mockResolvedValue('access-token')
    const postMessage = mount()
    bridge.receive!({ type: 'dsh://tauri:invoke', cmd: 'desktop_auth_access_token', nonce: 'token' }, { origin: 'http://127.0.0.1:3081' })
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'dsh://tauri:reply', nonce: 'token', ok: true, value: 'access-token' }, 'http://127.0.0.1:3081'))
    expect(bridge.invoke).toHaveBeenCalledWith('desktop_auth_access_token', undefined)
  })
})
