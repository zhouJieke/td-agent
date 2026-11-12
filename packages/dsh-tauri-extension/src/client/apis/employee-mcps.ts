import type { PostApiTauriExtensionMcpBody } from './index.type'
import { invoke } from 'dsh-tauri/client'

export type EmployeeMcpConfig = Omit<PostApiTauriExtensionMcpBody, 'scope' | 'serverName'> & { name: string }

export interface EmployeeMcpPage {
  totalCount: number
  pageNumber: number
  pagesAvailable: number
  items: { id: string, name: string, transport: string }[]
  empty: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function responseData(response: unknown): unknown {
  if (!isRecord(response) || typeof response.code !== 'number')
    throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
  if (response.code !== 0)
    throw new Error(typeof response.msg === 'string' && response.msg !== '' ? response.msg : 'EMPLOYEE_MCP_REQUEST_FAILED')
  return response.data
}

export async function getEmployeeMcp(mcpCode: string): Promise<EmployeeMcpConfig> {
  if (mcpCode.trim() === '' || mcpCode === '.' || mcpCode === '..')
    throw new Error('EMPLOYEE_MCP_INVALID_QUERY')
  const data = responseData(await invoke<unknown>('desktop_auth_request', {
    method: 'GET',
    path: `/api/employee-mcps/${encodeURIComponent(mcpCode)}`,
    body: null,
  }))
  if (!isRecord(data) || data.id !== mcpCode || !/^[\w-]{1,32}$/.test(mcpCode)
    || typeof data.name !== 'string' || data.name.trim() === '') {
    throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
  }
  const stringMap = (value: unknown): Record<string, string> | undefined => {
    if (value === undefined || value === null)
      return undefined
    if (!isRecord(value) || !Object.values(value).every(entry => typeof entry === 'string'))
      throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
    return value as Record<string, string>
  }
  if (data.transport === 'stdio') {
    if (typeof data.command !== 'string' || data.command.trim() === ''
      || (data.args != null && (!Array.isArray(data.args) || !data.args.every(arg => typeof arg === 'string')))
      || (data.cwd != null && typeof data.cwd !== 'string')) {
      throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
    }
    return {
      id: mcpCode,
      name: data.name,
      transport: 'stdio',
      command: data.command,
      args: (data.args ?? []) as string[],
      env: stringMap(data.env) ?? {},
      ...(typeof data.cwd === 'string' ? { cwd: data.cwd } : {}),
    }
  }
  if (data.transport !== 'streamable-http' || typeof data.url !== 'string')
    throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
  let url: URL
  try {
    url = new URL(data.url)
  }
  catch {
    throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '')
    throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
  return { id: mcpCode, name: data.name, transport: 'streamable-http', url: data.url, headers: stringMap(data.headers) ?? {} }
}

export async function getEmployeeMcps({ pageNo = 1, pageSize = 20, keyword = '' }: { pageNo?: number, pageSize?: number, keyword?: string } = {}): Promise<EmployeeMcpPage> {
  if (!isCount(pageNo) || pageNo === 0 || !isCount(pageSize) || pageSize === 0 || typeof keyword !== 'string')
    throw new Error('EMPLOYEE_MCP_INVALID_QUERY')
  const query = new URLSearchParams({ pageNo: String(pageNo), pageSize: String(pageSize) })
  if (keyword.trim() !== '')
    query.set('keyword', keyword.trim())
  const response = await invoke<unknown>('desktop_auth_request', {
    method: 'GET',
    path: `/api/employee-mcps?${query}`,
    body: null,
  })
  const page = responseData(response)
  if (!isRecord(page) || !isCount(page.totalCount) || !isCount(page.pageNumber) || page.pageNumber === 0
    || !isCount(page.pagesAvailable) || typeof page.empty !== 'boolean' || !Array.isArray(page.items)) {
    throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
  }
  const items = page.items.map((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id.trim() === ''
      || typeof item.name !== 'string' || item.name.trim() === '' || typeof item.transport !== 'string' || item.transport.trim() === '') {
      throw new Error('EMPLOYEE_MCP_INVALID_RESPONSE')
    }
    return { id: item.id, name: item.name, transport: item.transport }
  })
  return { totalCount: page.totalCount, pageNumber: page.pageNumber, pagesAvailable: page.pagesAvailable, empty: page.empty, items }
}
