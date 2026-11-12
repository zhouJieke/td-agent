import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getMcp, postMcp } from '../apis'
import { getEmployeeMcp } from '../apis/employee-mcps'
import { installEmployeeMcp } from './employee-mcps'

vi.mock('../apis', () => ({ getMcp: vi.fn(), postMcp: vi.fn() }))
vi.mock('../apis/employee-mcps', () => ({ getEmployeeMcp: vi.fn() }))

beforeEach(() => {
  vi.mocked(getEmployeeMcp).mockResolvedValue({ id: 'maps', name: '地图', transport: 'streamable-http', url: 'https://mcp.example.test', headers: { 'X-API-Key': 'test-key' } })
  vi.mocked(getMcp).mockResolvedValue({ servers: [], restartNeeded: false })
  vi.mocked(postMcp).mockResolvedValue({ ok: true, id: 'employee-mcp-maps', restartNeeded: false })
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

it('企业安装将详情配置保存到当前 profile 并使用稳定本地标识', async () => {
  await expect(installEmployeeMcp({ mcpCode: 'maps' })).resolves.toEqual({ ok: true, restartNeeded: false })
  expect(getEmployeeMcp).toHaveBeenCalledExactlyOnceWith('maps')
  expect(postMcp).toHaveBeenCalledExactlyOnceWith({
    id: 'employee-mcp-maps',
    serverName: 'maps',
    scope: 'profile',
    transport: 'streamable-http',
    url: 'https://mcp.example.test',
    headers: { 'X-API-Key': 'test-key' },
  })
})

it.each(['global', 'profile'] as const)('已有 %s 企业 MCP 时拒绝覆盖配置或改变关闭状态', async (scope) => {
  vi.mocked(getMcp).mockResolvedValue({ servers: [{ id: 'employee-mcp-maps', serverName: 'maps', transport: 'streamable-http', disabled: true, scope }], restartNeeded: false })
  await expect(installEmployeeMcp({ mcpCode: 'maps' })).resolves.toEqual({ ok: false, error: 'EMPLOYEE_MCP_ALREADY_INSTALLED' })
  expect(postMcp).not.toHaveBeenCalled()
})

it('本地配置读取失败时不进行安装写入', async () => {
  vi.mocked(getMcp).mockResolvedValue({ servers: [], globalError: 'invalid global patch', restartNeeded: false })
  await expect(installEmployeeMcp({ mcpCode: 'maps' })).resolves.toEqual({ ok: false, error: 'invalid global patch' })
  expect(postMcp).not.toHaveBeenCalled()
})

it('保存失败返回错误，宿主不能热加载时传递重启要求', async () => {
  vi.mocked(postMcp).mockResolvedValueOnce({ error: 'disk full' }).mockResolvedValueOnce({ ok: true, id: 'employee-mcp-maps', restartNeeded: true })
  await expect(installEmployeeMcp({ mcpCode: 'maps' })).resolves.toEqual({ ok: false, error: 'disk full' })
  await expect(installEmployeeMcp({ mcpCode: 'maps' })).resolves.toEqual({ ok: true, restartNeeded: true })
})
