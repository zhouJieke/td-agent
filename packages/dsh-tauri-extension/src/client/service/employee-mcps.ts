import { getMcp, postMcp } from '../apis'
import { getEmployeeMcp } from '../apis/employee-mcps'
import { EMPLOYEE_MCP_ID_PREFIX } from '../constants'

export async function installEmployeeMcp({ mcpCode }: { mcpCode: string }): Promise<{ ok: boolean, restartNeeded?: boolean, error?: string }> {
  try {
    const detail = await getEmployeeMcp(mcpCode)
    const current = await getMcp()
    if ('error' in current)
      throw new Error(current.error)
    if (current.globalError)
      throw new Error(current.globalError)
    const id = `${EMPLOYEE_MCP_ID_PREFIX}${detail.id}`
    if (current.servers.some(row => row.id === id))
      throw new Error('EMPLOYEE_MCP_ALREADY_INSTALLED')
    const result = await postMcp({
      id,
      serverName: detail.id,
      scope: 'profile',
      transport: detail.transport,
      ...(detail.transport === 'stdio'
        ? { command: detail.command, args: detail.args, env: detail.env, cwd: detail.cwd }
        : { url: detail.url, headers: detail.headers }),
    })
    if ('error' in result)
      throw new Error(result.error)
    return { ok: result.ok, restartNeeded: result.restartNeeded }
  }
  catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
