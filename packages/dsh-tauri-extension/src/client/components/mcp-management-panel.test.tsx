// @vitest-environment jsdom
import type { ClientContext } from 'dsh-tauri/client'
import type { McpRow } from '../types'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { definePanel, invoke } from 'dsh-tauri/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteMcp, getMcp, postMcp, postMcpCheck, postMcpToggle } from '../apis'
import { apply } from '../index'
import { locale } from '../locales'
import { mcpPanelFeature } from '../register/mcp-panel'
import { McpTab } from './mcp-tab'

vi.mock('../apis', () => ({ getMcp: vi.fn(), postMcp: vi.fn(), postMcpCheck: vi.fn(), postMcpToggle: vi.fn(), deleteMcp: vi.fn() }))
vi.mock('dsh-tauri/client', async importOriginal => ({
  ...await importOriginal<typeof import('dsh-tauri/client')>(),
  definePanel: vi.fn(),
  invoke: vi.fn(),
}))

const enterprisePage = { totalCount: 1, pageNumber: 1, pagesAvailable: 1, items: [{ id: 'amap-maps-streamableHTTP', name: '高德地图 MCP', transport: 'streamable-http' }], empty: false }

beforeEach(() => {
  vi.mocked(invoke).mockResolvedValue({ code: 0, msg: null, data: enterprisePage })
  vi.mocked(getMcp).mockResolvedValue({ servers: [], restartNeeded: false })
  vi.mocked(postMcp).mockResolvedValue({ ok: true, id: 'custom', restartNeeded: false })
  vi.mocked(postMcpCheck).mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('独立 MCP 管理页面', () => {
  it.each([
    { transport: 'streamable-http' as const, url: 'https://mcp.example.test', headers: { Authorization: 'Bearer header-secret' }, field: 'Authorization', secret: 'Bearer header-secret' },
    { transport: 'stdio' as const, command: 'node', env: { API_KEY: 'env-secret' }, field: 'API_KEY', secret: 'env-secret' },
    { transport: 'streamable-http' as const, url: 'https://mcp.example.test?key=url-secret', field: 'key', secret: 'url-secret' },
  ])('已安装 $transport 的 $field 默认遮挡密钥，可显示后再次隐藏', async ({ field, secret, ...config }) => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [{ id: 'secured', serverName: 'Secured MCP', disabled: false, scope: 'profile', ...config }], restartNeeded: false })
    render(<McpTab t={locale.text} />)
    await screen.findByText('Secured MCP')
    expect(screen.getByText(field).textContent).toBe(field)
    expect(screen.getByText('••••••••').textContent).toBe('••••••••')
    expect(document.body.textContent).not.toContain(secret)
    expect(document.querySelector(`[title*="${secret}"]`)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show credentials: Secured MCP' }))
    expect(screen.getByText(secret).textContent).toBe(secret)
    fireEvent.click(screen.getByRole('button', { name: 'Hide credentials: Secured MCP' }))
    expect(document.body.textContent).not.toContain(secret)
  })

  it.each([
    { source: '请求头', config: { transport: 'streamable-http', url: 'https://mcp.example.test', headers: { Authorization: 'Bearer enterprise-secret' } } },
    { source: '环境变量', config: { transport: 'stdio', command: 'node', env: { API_KEY: 'enterprise-secret' } } },
    { source: 'URL 参数', config: { transport: 'streamable-http', url: 'https://mcp.example.test?key=enterprise-secret' } },
    { source: '空配置', config: { transport: 'stdio', command: 'node' } },
  ] satisfies { source: string, config: Partial<McpRow> }[])('通过企业入口安装的 MCP 不显示密钥区域：$source', async ({ config }) => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [{ id: 'employee-mcp-secured', serverName: 'Enterprise MCP', disabled: false, scope: 'profile', ...config }], restartNeeded: false })
    render(<McpTab t={locale.text} />)
    await screen.findByText('Enterprise MCP')
    expect(screen.queryByText('Credentials')).toBeNull()
    expect(screen.queryByText('No credentials configured')).toBeNull()
    expect(screen.queryByRole('button', { name: /Show credentials|Hide credentials/ })).toBeNull()
    expect(screen.queryByText('Authorization')).toBeNull()
    expect(screen.queryByText('API_KEY')).toBeNull()
    expect(screen.queryByText('key')).toBeNull()
    expect(document.body.innerHTML).not.toContain('enterprise-secret')
  })

  it('未配置请求头、环境变量或 URL 参数的连接器整块不显示密钥区', async () => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [{ id: 'local', serverName: 'Local MCP', transport: 'stdio', command: 'node', disabled: false }], restartNeeded: false })
    render(<McpTab t={locale.text} />)
    await screen.findByText('Local MCP')
    expect(screen.queryByText('No credentials configured')).toBeNull()
    expect(screen.queryByText('Credentials')).toBeNull()
    expect(screen.queryByRole('button', { name: /Show credentials/ })).toBeNull()
  })

  it('同名连接器的密钥按范围独立显示，刷新列表后重新遮挡', async () => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [
      { id: 'same', serverName: 'Profile MCP', transport: 'stdio', command: 'node', disabled: false, scope: 'profile', env: { API_KEY: 'profile-secret' } },
      { id: 'same', serverName: 'Global MCP', transport: 'streamable-http', url: 'https://mcp.example.test?key=url-secret', disabled: false, scope: 'global', headers: { Authorization: 'global-secret', Empty: '' } },
    ], restartNeeded: false })
    render(<McpTab t={locale.text} />)
    await screen.findByText('Profile MCP')
    fireEvent.click(screen.getByRole('button', { name: 'Show credentials: Global MCP' }))
    expect(screen.getByText('global-secret').textContent).toBe('global-secret')
    expect(screen.getByText('url-secret').textContent).toBe('url-secret')
    expect(screen.queryByText('profile-secret')).toBeNull()
    expect(screen.queryByText('Empty')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh installed' }))
    await screen.findByRole('button', { name: 'Show credentials: Global MCP' })
    expect(screen.queryByText('global-secret')).toBeNull()
    expect(screen.queryByText('url-secret')).toBeNull()
    expect(getMcp).toHaveBeenCalledTimes(2)
  })

  it('已安装列表不再提供从其他 Agent 导入的入口', async () => {
    render(<McpTab t={locale.text} />)
    await screen.findByText('No MCP servers configured yet')
    expect(screen.queryByRole('button', { name: 'Import from other agents' })).toBeNull()
    expect(screen.queryByText('Scan Claude Code and Codex MCP configs and import selected entries.')).toBeNull()
  })

  it('客户端装配独立入口并在技能中心下方注册，卸载时移除面板', () => {
    const effect = vi.fn()
    apply({ effect } as unknown as ClientContext)
    expect(effect).toHaveBeenCalledWith(mcpPanelFeature, 'dsh-tauri-extension: mcp panel')
    const dispose = vi.fn()
    vi.mocked(definePanel).mockReturnValue({ dispose, select: vi.fn(), close: vi.fn() })
    const context = {} as ClientContext
    const release = mcpPanelFeature.call(context)
    const entry = vi.mocked(definePanel).mock.calls[0]?.[1]
    expect(entry).toMatchObject({ id: 'dsh-tauri-extension.mcp', order: 61 })
    expect(typeof entry?.label === 'function' ? entry.label() : entry?.label).toBe('MCP Connectors')
    release()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('默认展示已安装列表，切换企业入口时通过桌面鉴权加载目录并保留本地列表', async () => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [
      { id: 'existing', serverName: 'local-tools', transport: 'stdio', command: 'node', args: ['tools.js'], disabled: false, scope: 'profile' },
    ], restartNeeded: false })
    render(<McpTab t={locale.text} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('MCP Connectors')
    const installed = screen.getByRole('tab', { name: /^Installed/ })
    const enterprise = screen.getByRole('tab', { name: 'Enterprise MCPs' })
    expect(installed.getAttribute('aria-selected')).toBe('true')
    await screen.findByText('local-tools')
    expect(invoke).not.toHaveBeenCalled()
    fireEvent.click(enterprise)
    expect(enterprise.getAttribute('aria-selected')).toBe('true')
    await screen.findByText('高德地图 MCP')
    expect(screen.getByText('1 MCPs').textContent).toBe('1 MCPs')
    expect(screen.getByText('amap-maps-streamableHTTP').textContent).toBe('amap-maps-streamableHTTP')
    expect(within(screen.getByRole('tabpanel')).queryByText('streamable-http')).toBeNull()
    const install = screen.getByRole('button', { name: 'Install' })
    expect(install.textContent).toBe('')
    expect(install.querySelector('svg')).not.toBeNull()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('desktop_auth_request', { method: 'GET', path: '/api/employee-mcps?pageNo=1&pageSize=20', body: null })
    expect(screen.getByRole('button', { name: 'Refresh enterprise catalog' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Add custom MCP' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(installed)
    expect(screen.getByRole('tabpanel').id).toBe(installed.getAttribute('aria-controls'))
    expect(screen.getByText('local-tools').closest<HTMLElement>('[role="tabpanel"]')?.hidden).toBe(false)
    expect(getMcp).toHaveBeenCalledOnce()
  })

  it('从企业页自定义安装与企业目录同名同地址的 MCP 后仍可查看密钥', async () => {
    render(<McpTab t={locale.text} />)
    await screen.findByText('No MCP servers configured yet')
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    await screen.findByText('高德地图 MCP')
    fireEvent.click(screen.getByRole('button', { name: 'Add custom MCP' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Paste a JSON config (wrapper or bare entry)' }), {
      target: { value: '{"mcpServers":{"amap-maps-streamableHTTP":{"url":"https://mcp.example.test/maps","headers":{"Authorization":"Bearer custom-secret"}}}}' },
    })
    vi.mocked(getMcp).mockResolvedValue({ servers: [
      { id: 'mcp-amap-maps-streamableHTTP', serverName: 'amap-maps-streamableHTTP', transport: 'streamable-http', url: 'https://mcp.example.test/maps', headers: { Authorization: 'Bearer custom-secret' }, disabled: false, scope: 'profile' },
    ], restartNeeded: false })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(postMcp).toHaveBeenCalledExactlyOnceWith({
      id: '',
      scope: 'profile',
      serverName: 'amap-maps-streamableHTTP',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/maps',
      headers: { Authorization: 'Bearer custom-secret' },
    }))
    const showCredentials = await screen.findByRole('button', { name: 'Show credentials: amap-maps-streamableHTTP' })
    expect(screen.getByRole('tab', { name: 'Installed 1' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getMcp).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Credentials').textContent).toBe('Credentials')
    expect(screen.queryByText('Bearer custom-secret')).toBeNull()
    fireEvent.click(showCredentials)
    expect(screen.getByText('Bearer custom-secret').textContent).toBe('Bearer custom-secret')
  })

  it('自定义保存失败时保留配置内容并显示错误，允许重试', async () => {
    vi.mocked(postMcp).mockResolvedValue({ error: 'MCP_SAVE_FAILED' })
    render(<McpTab t={locale.text} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add custom MCP' }))
    const input = screen.getByRole('textbox', { name: 'Paste a JSON config (wrapper or bare entry)' })
    const json = '{"mcpServers":{"custom":{"command":"node"}}}'
    fireEvent.change(input, { target: { value: json } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('MCP_SAVE_FAILED')
    expect((input as HTMLTextAreaElement).value).toBe(json)
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false)
    expect(getMcp).toHaveBeenCalledOnce()
  })

  it('企业 MCP 安装默认开启，关闭后不再检测连接，重新开启和卸载更新本地列表', async () => {
    let servers: McpRow[] = []
    vi.mocked(getMcp).mockImplementation(async () => ({ servers, restartNeeded: false }))
    vi.mocked(invoke).mockImplementation(async (_command, args) => ({
      code: 0,
      data: (args as { path: string }).path.includes('?') ? enterprisePage : { ...enterprisePage.items[0], url: 'https://mcp.example.test/maps', headers: { Authorization: 'Bearer enterprise-secret' } },
    }))
    vi.mocked(postMcp).mockImplementation(async (body) => {
      servers = [{ ...body, disabled: false }]
      return { ok: true, id: body.id, restartNeeded: false }
    })
    vi.mocked(postMcpToggle).mockImplementation(async ({ disabled }) => {
      servers = servers.map(row => ({ ...row, disabled }))
      return { ok: true, restartNeeded: false }
    })
    vi.mocked(deleteMcp).mockImplementation(async () => {
      servers = []
      return { ok: true, restartNeeded: false }
    })
    render(<McpTab t={locale.text} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    const toggle = await screen.findByRole('switch', { name: 'Enable or disable MCP: amap-maps-streamableHTTP' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(postMcp).toHaveBeenCalledExactlyOnceWith({
      id: 'employee-mcp-amap-maps-streamableHTTP',
      serverName: 'amap-maps-streamableHTTP',
      transport: 'streamable-http',
      url: 'https://mcp.example.test/maps',
      headers: { Authorization: 'Bearer enterprise-secret' },
      scope: 'profile',
    })
    expect(screen.queryByText('Credentials')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show credentials: amap-maps-streamableHTTP' })).toBeNull()
    expect(document.body.innerHTML).not.toContain('enterprise-secret')
    expect(invoke).toHaveBeenCalledWith('desktop_auth_request', { method: 'GET', path: '/api/employee-mcps/amap-maps-streamableHTTP', body: null })
    await waitFor(() => expect(postMcpCheck).toHaveBeenCalledTimes(1))
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
    expect(postMcpToggle).toHaveBeenLastCalledWith({ id: 'employee-mcp-amap-maps-streamableHTTP', disabled: true, scope: 'profile' })
    expect(postMcpCheck).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Check' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(postMcpToggle).toHaveBeenLastCalledWith({ id: 'employee-mcp-amap-maps-streamableHTTP', disabled: false, scope: 'profile' })
    await waitFor(() => expect(postMcpCheck).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    await screen.findByText('No enterprise MCPs found. Try another keyword.')
    expect(within(screen.getByRole('tabpanel')).queryByText('amap-maps-streamableHTTP')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Installed 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Uninstall this MCP?' })).getByRole('button', { name: 'Uninstall' }))
    await screen.findByText('No MCP servers configured yet')
    expect(deleteMcp).toHaveBeenCalledExactlyOnceWith({ id: 'employee-mcp-amap-maps-streamableHTTP', scope: 'profile' })
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    expect((await screen.findByRole('button', { name: 'Install' })).hasAttribute('disabled')).toBe(false)
  })

  it('安装详情失败不写本地配置，保留安装按钮供重试', async () => {
    render(<McpTab t={locale.text} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    const install = await screen.findByRole('button', { name: 'Install' })
    vi.mocked(invoke).mockResolvedValue({ code: 1, msg: '无安装权限' })
    fireEvent.click(install)
    await screen.findByText('Operation failed: 无安装权限')
    expect(postMcp).not.toHaveBeenCalled()
    expect(install.hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('tab', { name: 'Enterprise MCPs' }).getAttribute('aria-selected')).toBe('true')
  })

  it.each([
    { scope: 'global' as const, disabled: false },
    { scope: 'profile' as const, disabled: true },
  ])('企业目录隐藏 $scope 范围已安装项，保留自定义同名项的安装入口', async ({ scope, disabled }) => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [
      { id: 'employee-mcp-amap-maps-streamableHTTP', serverName: 'installed-maps', transport: 'stdio', command: 'node', disabled, scope },
      { id: 'mcp-docs', serverName: '文档助手 MCP', transport: 'stdio', command: 'node', disabled: false, scope: 'profile' },
    ], restartNeeded: false })
    vi.mocked(invoke).mockImplementation(async (_command, args) => ({
      code: 0,
      data: (args as { path: string }).path.endsWith('/meta')
        ? []
        : { ...enterprisePage, totalCount: 2, items: [...enterprisePage.items, { id: 'docs', name: '文档助手 MCP', transport: 'stdio' }] },
    }))
    render(<McpTab t={locale.text} />)
    await screen.findByText('installed-maps')
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))

    const enterprise = within(screen.getByRole('tabpanel'))
    await enterprise.findByText('docs')
    expect(enterprise.queryByText('高德地图 MCP')).toBeNull()
    expect(enterprise.queryByText('amap-maps-streamableHTTP')).toBeNull()
    expect(enterprise.getByText('文档助手 MCP').textContent).toBe('文档助手 MCP')
    expect(enterprise.getAllByRole('button', { name: 'Install' })).toHaveLength(1)
    expect(enterprise.getByRole('button', { name: 'Install' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('tab', { name: 'Installed 2' }))
    const installed = within(screen.getByRole('tabpanel'))
    expect(installed.getByText('installed-maps').textContent).toBe('installed-maps')
    expect(installed.getByRole('switch', { name: 'Enable or disable MCP: installed-maps' }).getAttribute('aria-checked')).toBe(String(!disabled))
  })

  it('开关或卸载失败保留原状态，卸载弹窗允许重试', async () => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [{ id: 'local', serverName: 'local', transport: 'stdio', command: 'node', disabled: true, scope: 'profile' }], restartNeeded: false })
    vi.mocked(postMcpToggle).mockResolvedValue({ error: 'toggle failed' })
    vi.mocked(deleteMcp).mockResolvedValue({ error: 'remove failed' })
    render(<McpTab t={locale.text} />)
    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)
    await screen.findByText('Operation failed: toggle failed')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }))
    await screen.findByText('Operation failed: remove failed')
    expect(within(dialog).getByRole('button', { name: 'Uninstall' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('tab', { name: 'Installed 1', hidden: true }).getAttribute('aria-selected')).toBe('true')
  })

  it('搜索名称和服务命令时忽略大小写，数量保持已安装总数并提供无匹配提示', async () => {
    vi.mocked(getMcp).mockResolvedValue({ servers: [
      { id: 'calendar', serverName: 'Calendar', transport: 'stdio', command: 'node', args: ['calendar.js'], disabled: false, scope: 'profile' },
      { id: 'docs', serverName: 'Documents', transport: 'stdio', command: 'python', args: ['docs.py'], disabled: true, scope: 'global' },
    ], restartNeeded: false })
    render(<McpTab t={locale.text} />)
    await screen.findByText('Calendar')
    const search = screen.getByRole('searchbox', { name: 'Search MCP name or server address' })
    fireEvent.change(search, { target: { value: '  DOCS.PY  ' } })
    expect(screen.getByText('Documents').textContent).toBe('Documents')
    expect(screen.queryByText('Calendar')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Installed 2' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByText('No matching MCPs').textContent).toBe('No matching MCPs')
    expect(screen.queryByText('No MCP servers configured yet')).toBeNull()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByText('Calendar').textContent).toBe('Calendar')
    expect(screen.getByText('Documents').textContent).toBe('Documents')
  })

  it('列表加载失败显示持久错误，刷新成功后展示真实卡片', async () => {
    vi.mocked(getMcp).mockResolvedValueOnce({ error: 'MCP_UNAVAILABLE' })
    render(<McpTab t={locale.text} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Operation failed: MCP_UNAVAILABLE')
    expect(screen.queryByText('No MCP servers configured yet')).toBeNull()
    vi.mocked(getMcp).mockResolvedValue({ servers: [
      { id: 'recovered', serverName: 'Recovered', transport: 'stdio', command: 'node', disabled: false, scope: 'profile' },
    ], restartNeeded: false })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh installed' }))
    await screen.findByText('Recovered')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('tab', { name: 'Installed 1' }).getAttribute('aria-selected')).toBe('true')
    expect(getMcp).toHaveBeenCalledTimes(2)
  })

  it('企业目录分页和刷新携带当前查询，搜索时重置页码并编码关键词', async () => {
    vi.mocked(invoke).mockResolvedValue({ code: 0, data: { ...enterprisePage, totalCount: 21, pagesAvailable: 2 } })
    render(<McpTab t={locale.text} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    await screen.findByText('高德地图 MCP')
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true)
    vi.mocked(invoke).mockResolvedValue({ code: 0, data: { ...enterprisePage, totalCount: 21, pageNumber: 2, pagesAvailable: 2 } })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await screen.findByText('2 / 2')
    expect(invoke).toHaveBeenLastCalledWith('desktop_auth_request', { method: 'GET', path: '/api/employee-mcps?pageNo=2&pageSize=20', body: null })
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh enterprise catalog' }))
    await screen.findByText('2 / 2')
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(invoke).toHaveBeenLastCalledWith('desktop_auth_request', { method: 'GET', path: '/api/employee-mcps?pageNo=2&pageSize=20', body: null })
    vi.mocked(invoke).mockResolvedValue({ code: 0, data: enterprisePage })
    const search = screen.getByRole('searchbox')
    fireEvent.change(search, { target: { value: ' 高德 & 地图 ' } })
    await screen.findByText('1 / 1')
    expect(invoke).toHaveBeenLastCalledWith('desktop_auth_request', { method: 'GET', path: '/api/employee-mcps?pageNo=1&pageSize=20&keyword=%E9%AB%98%E5%BE%B7+%26+%E5%9C%B0%E5%9B%BE', body: null })
    fireEvent.click(screen.getByRole('tab', { name: /^Installed/ }))
    expect((search as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    expect((search as HTMLInputElement).value).toBe(' 高德 & 地图 ')
    await screen.findByText('高德地图 MCP')
  })

  it('企业目录请求失败可刷新重试，空响应显示空状态而非加载失败', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('DESKTOP_AUTH_SESSION_MISSING'))
    render(<McpTab t={locale.text} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Operation failed: DESKTOP_AUTH_SESSION_MISSING')
    expect(screen.queryByText('No enterprise MCPs found. Try another keyword.')).toBeNull()
    vi.mocked(invoke).mockResolvedValue({ code: 0, data: { totalCount: 0, pageNumber: 1, pagesAvailable: 0, items: [], empty: true } })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh enterprise catalog' }))
    await screen.findByText('No enterprise MCPs found. Try another keyword.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true)
  })

  it('搜索的旧响应晚于新响应返回时保留最新目录', async () => {
    let resolveOld!: (value: unknown) => void
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => {
      resolveOld = resolve
    }))
    render(<McpTab t={locale.text} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Enterprise MCPs' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '高德' } })
    await screen.findByText('高德地图 MCP')
    await act(async () => resolveOld({ code: 0, data: { ...enterprisePage, items: [{ id: 'old', name: 'Outdated MCP', transport: 'stdio' }] } }))
    expect(screen.queryByText('Outdated MCP')).toBeNull()
    expect(screen.getByText('高德地图 MCP').textContent).toBe('高德地图 MCP')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
