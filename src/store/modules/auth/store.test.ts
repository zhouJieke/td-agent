import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth } from './index'

const ipc = vi.hoisted(() => ({ native: true, invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => ipc.native, invoke: ipc.invoke }))

const session = { employeeNumber: 'TD000001', employeeName: '张三', expiresAt: 1800000000000 }

beforeEach(() => {
  ipc.native = true
  ipc.invoke.mockReset()
  ipc.invoke.mockResolvedValue(null)
  auth.session = null
  auth.ticket = null
  auth.expired = false
})

afterEach(async () => {
  await auth.cancel()
  auth.session = null
  vi.restoreAllMocks()
})

describe('桌面登录状态', () => {
  it('浏览器环境在 IPC 调用前拦截登录', async () => {
    ipc.native = false
    await expect(auth.begin('dingtalk')).rejects.toThrow('DESKTOP_AUTH_NATIVE_REQUIRED')
    await auth.initialize()
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('初始化只读取 Rust 会话，不读取 Web Storage', async () => {
    ipc.invoke.mockResolvedValueOnce(session)
    await auth.initialize()
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_session')
    expect(auth.session).toEqual(session)
  })

  it('取消开始请求后晚返回的二维码不恢复', async () => {
    let resolve!: (value: unknown) => void
    ipc.invoke.mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    const begin = auth.begin('wecom')
    await auth.cancel()
    resolve({ loginId: 1, authUrl: 'https://login.dingtalk.com/old' })
    await begin
    expect(auth.ticket).toBeNull()
  })

  it('领取成功从令牌附带员工信息进入登录态', async () => {
    auth.ticket = { loginId: 1, authUrl: 'https://login.dingtalk.com/qr' }
    ipc.invoke.mockResolvedValueOnce({ status: 'authenticated', session })
    await auth.claim()
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_claim', { loginId: 1 })
    expect(auth.session).toEqual(session)
    expect(auth.ticket).toBeNull()
    expect(Object.keys(auth)).not.toContain('tokens')
  })

  it('正在领取时合并调用，202 保留当前二维码', async () => {
    let resolve!: (value: unknown) => void
    ipc.invoke.mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    auth.ticket = { loginId: 1, authUrl: 'https://login.dingtalk.com/qr' }
    const first = auth.claim()
    const second = auth.claim()
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
    resolve({ status: 'pending' })
    await Promise.all([first, second])
    expect(auth.ticket?.loginId).toBe(1)
    expect(auth.session).toBeNull()
  })

  it('重新生成后旧领取成功也不会覆盖新票据', async () => {
    let resolve!: (value: unknown) => void
    auth.ticket = { loginId: 1, authUrl: 'https://login.dingtalk.com/old' }
    ipc.invoke.mockImplementationOnce(() => new Promise((done) => {
      resolve = done
    }))
    const oldClaim = auth.claim()
    ipc.invoke.mockResolvedValueOnce({ loginId: 2, authUrl: 'https://login.dingtalk.com/new' })
    await auth.begin('dingtalk')
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_begin', { platform: 'dingtalk' })
    resolve({ status: 'authenticated', session })
    await oldClaim
    expect(auth.ticket?.loginId).toBe(2)
    expect(auth.session).toBeNull()
  })

  it('410 停止领取并显示过期状态', async () => {
    auth.ticket = { loginId: 1, authUrl: 'https://login.dingtalk.com/qr' }
    ipc.invoke.mockResolvedValueOnce({ status: 'expired' })
    await auth.claim()
    expect(auth.ticket).toBeNull()
    expect(auth.expired).toBe(true)
  })

  it('领取失败清除票据并向界面交付错误', async () => {
    auth.ticket = { loginId: 1, authUrl: 'https://login.dingtalk.com/qr' }
    ipc.invoke.mockRejectedValueOnce('DESKTOP_AUTH_NETWORK')
    await expect(auth.claim()).rejects.toBe('DESKTOP_AUTH_NETWORK')
    expect(auth.ticket).toBeNull()
    expect(auth.session).toBeNull()
  })

  it('原生刷新失败失去登录态时清除员工会话', async () => {
    auth.session = session
    ipc.invoke.mockRejectedValueOnce('DESKTOP_AUTH_SESSION_MISSING')
    await expect(auth.accessToken()).rejects.toBe('DESKTOP_AUTH_SESSION_MISSING')
    expect(auth.session).toBeNull()
  })
  it('鉴权业务请求只走 Rust，并在失去会话时清除员工状态', async () => {
    auth.session = session
    ipc.invoke.mockRejectedValueOnce('DESKTOP_AUTH_SESSION_MISSING')
    await expect(auth.request('/api/private')).rejects.toBe('DESKTOP_AUTH_SESSION_MISSING')
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_request', { method: 'GET', path: '/api/private', body: null })
    expect(auth.session).toBeNull()
  })

  it('鉴权业务提交把 JSON 载荷交给 Rust', async () => {
    ipc.invoke.mockResolvedValueOnce({ saved: true })
    await expect(auth.request('/api/private', { method: 'POST', body: { name: 'demo' } })).resolves.toEqual({ saved: true })
    expect(ipc.invoke).toHaveBeenCalledWith('desktop_auth_request', { method: 'POST', path: '/api/private', body: { name: 'demo' } })
  })
  it('续期时凭据库被锁定则清除界面登录态并交付重试错误', async () => {
    auth.session = session
    ipc.invoke.mockRejectedValueOnce('DESKTOP_AUTH_VAULT_UNAVAILABLE')
    await expect(auth.initialize()).rejects.toBe('DESKTOP_AUTH_VAULT_UNAVAILABLE')
    expect(auth.session).toBeNull()
  })
})
