import type { Translate } from '../locales/index.types'

export type McpEditorMode = 'json' | 'form'

export interface McpEditorState {
  id: string
  scope: 'global' | 'profile'
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string
  env: string
  url: string
  headers: string
}

export interface ParsedMcpJson {
  serverName?: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface McpTabProps {
  t: Translate
}
