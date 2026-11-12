import { invoke } from 'dsh-tauri/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmployeeMcp, getEmployeeMcps } from './employee-mcps'

vi.mock('dsh-tauri/client', () => ({ invoke: vi.fn() }))

const page = {
  totalCount: 1,
  pageNumber: 1,
  pagesAvailable: 1,
  items: [{ id: 'amap-maps-streamableHTTP', name: '高德地图 MCP', transport: 'streamable-http' }],
  empty: false,
}

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue({ code: 0, msg: null, data: page })
})

describe('企业 MCP 配置详情 API', () => {
  const detail = { id: 'amap-maps-streamableHTTP', name: '高德地图 MCP', transport: 'streamable-http', url: 'https://mcp.example.test/mcp?key=test-key' }

  it('通过桌面登录读取指定 MCP 的真实详情结构并保留连接参数', async () => {
    vi.mocked(invoke).mockResolvedValue({ code: 0, msg: null, data: detail })
    await expect(getEmployeeMcp(detail.id)).resolves.toEqual({ ...detail, headers: {} })
    expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_auth_request', {
      method: 'GET',
      path: '/api/employee-mcps/amap-maps-streamableHTTP',
      body: null,
    })
  })

  it('stdio 配置保留命令、参数、工作目录和环境变量', async () => {
    const config = { id: 'local-tools', name: '本地工具', transport: 'stdio', command: 'node', args: ['tools.js'], cwd: '/opt/tools', env: { MODE: 'enterprise' } }
    vi.mocked(invoke).mockResolvedValue({ code: 0, data: config })
    await expect(getEmployeeMcp('local-tools')).resolves.toEqual(config)
  })

  it('详情业务失败透传消息且不把目录元数据当作配置', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ code: 1, msg: '无安装权限' }).mockResolvedValueOnce({ code: 0, data: page.items[0] })
    await expect(getEmployeeMcp(detail.id)).rejects.toThrow('无安装权限')
    await expect(getEmployeeMcp(detail.id)).rejects.toThrow('EMPLOYEE_MCP_INVALID_RESPONSE')
  })

  it.each([
    { ...detail, id: 'other' },
    { ...detail, transport: 'sse' },
    { ...detail, url: 'file:///private' },
    { ...detail, url: 'https://user:password@example.test' },
    { ...detail, headers: { Authorization: 123 } },
    { ...detail, transport: 'stdio', command: 'node', args: 'tools.js' },
    { ...detail, transport: 'stdio', command: '' },
  ])('无效连接配置 %j 在安装前拒绝', async (data) => {
    vi.mocked(invoke).mockResolvedValue({ code: 0, data })
    await expect(getEmployeeMcp(detail.id)).rejects.toThrow('EMPLOYEE_MCP_INVALID_RESPONSE')
  })

  it('路径中的特殊字符作为单个 MCP 编码发送', async () => {
    vi.mocked(invoke).mockResolvedValue({ code: 1, msg: 'not found' })
    await expect(getEmployeeMcp('maps/a?b#c')).rejects.toThrow('not found')
    expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_auth_request', { method: 'GET', path: '/api/employee-mcps/maps%2Fa%3Fb%23c', body: null })
  })
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('企业 MCP 目录 API', () => {
  it('省略分页时使用第 1 页每页 20 条并通过桌面鉴权返回目录', async () => {
    await expect(getEmployeeMcps()).resolves.toEqual(page)
    expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_auth_request', {
      method: 'GET',
      path: '/api/employee-mcps?pageNo=1&pageSize=20',
      body: null,
    })
  })

  it('指定分页和关键词时传递页码与大小并安全编码中文特殊字符', async () => {
    await getEmployeeMcps({ pageNo: 3, pageSize: 50, keyword: '  地图 &a=1+#  ' })
    expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_auth_request', {
      method: 'GET',
      path: '/api/employee-mcps?pageNo=3&pageSize=50&keyword=%E5%9C%B0%E5%9B%BE+%26a%3D1%2B%23',
      body: null,
    })
  })

  it('空白关键词不发送 keyword 参数', async () => {
    await getEmployeeMcps({ keyword: '  ' })
    expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_auth_request', {
      method: 'GET',
      path: '/api/employee-mcps?pageNo=1&pageSize=20',
      body: null,
    })
  })

  it.each([{ pageNo: 0 }, { pageNo: -1 }, { pageNo: 1.5 }, { pageSize: 0 }, { pageSize: Number.NaN }, { pageSize: Number.POSITIVE_INFINITY }])('非法分页 %j 在发送请求前抛错', async (query) => {
    await expect(getEmployeeMcps(query)).rejects.toThrow('EMPLOYEE_MCP_INVALID_QUERY')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('空目录保留零页数和总数', async () => {
    const empty = { totalCount: 0, pageNumber: 1, pagesAvailable: 0, items: [], empty: true }
    vi.mocked(invoke).mockResolvedValue({ code: 0, data: empty })
    await expect(getEmployeeMcps()).resolves.toEqual(empty)
  })

  it('业务失败抛出服务端消息', async () => {
    vi.mocked(invoke).mockResolvedValue({ code: 1, msg: '无目录权限', data: null })
    await expect(getEmployeeMcps()).rejects.toThrow('无目录权限')
  })

  it('缺少失败消息时抛出明确错误码', async () => {
    vi.mocked(invoke).mockResolvedValue({ code: 1, msg: null, data: null })
    await expect(getEmployeeMcps()).rejects.toThrow('EMPLOYEE_MCP_REQUEST_FAILED')
  })

  it.each([null, {}, { code: 0, data: null }, { code: 0, data: { ...page, items: [{}] } }, { code: 0, data: { ...page, totalCount: -1 } }, { code: 0, data: { ...page, pageNumber: 0 } }])('无效响应 %j 抛错而非伪装为空目录', async (response) => {
    vi.mocked(invoke).mockResolvedValue(response)
    await expect(getEmployeeMcps()).rejects.toThrow('EMPLOYEE_MCP_INVALID_RESPONSE')
  })

  it('鉴权请求失败透传错误供页面重试', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('DESKTOP_AUTH_SESSION_MISSING'))
    await expect(getEmployeeMcps()).rejects.toThrow('DESKTOP_AUTH_SESSION_MISSING')
  })
})
