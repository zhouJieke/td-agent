import type { GetApiTauriExtensionMcpResponse, GetApiTauriExtensionSkillsResponse } from '../apis/index.type'

export type McpRow = Extract<GetApiTauriExtensionMcpResponse, { servers: unknown }>['servers'][number]
export type SkillRowView = Extract<GetApiTauriExtensionSkillsResponse, { skills: unknown }>['skills'][number]
