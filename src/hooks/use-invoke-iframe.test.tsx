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

  it('不会向帧开放 token 或任意鉴权请求命令', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const postMessage = mount()
    for (const cmd of ['desktop_auth_access_token', 'desktop_auth_request'])
      bridge.receive!({ type: 'dsh://tauri:invoke', cmd, nonce: cmd }, { origin: 'http://127.0.0.1:3081' })
    expect(bridge.invoke).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })
})
