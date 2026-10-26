import type { PresetRow, PresetTable } from '../../shared/model-presets'
import type { GatewayGrant, GatewayProfile } from './gateway.types'

const MODELS_PATH = '/api/ai/models'

const DEFAULT_API = 'openai-completions'

const DEFAULT_BASE_URL_SUFFIX = '/api/v1'

const DEFAULT_DISPLAY_NAME = 'AI Gateway'

const PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages'])

const GRADED_EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high' }

const SECRET_HEADERS = new Set(['authorization', 'x-api-key'])

const MIN_PREFIX_LENGTH = 3

function trimmedText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    return undefined
  return value
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value))
    return undefined
  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length === 0 ? undefined : items
}

function effortMap(value: unknown): Record<string, string | null> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([level]) => level.trim().length > 0)
    .map(([level, effort]) => [level, typeof effort === 'string' ? effort : null] as const)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

function headerRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined
  const record: Record<string, string> = {}
  for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
    const key = name.trim()
    const text = trimmedText(item)
    if (key.length === 0 || text === undefined || SECRET_HEADERS.has(key.toLowerCase()))
      continue
    record[key] = text
  }
  return Object.keys(record).length === 0 ? undefined : record
}

export function backendOf(env: NodeJS.ProcessEnv): string | undefined {
  const raw = trimmedText(env.DSH_MODEL_BACKEND_URL)
  if (raw === undefined)
    return undefined
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    return new URL(candidate).toString().replace(/\/+$/, '')
  }
  catch {
    return undefined
  }
}

export function modelsUrlOf(backend: string): string {
  return `${backend}${MODELS_PATH}`
}

function modelEntry(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return undefined
  const entry = value as Record<string, unknown>
  const id = trimmedText(entry.id)
  if (id === undefined)
    return undefined
  const name = trimmedText(entry.name)
  const contextWindow = positiveInteger(entry.contextWindow)
  const maxTokens = positiveInteger(entry.maxTokens)
  const input = stringList(entry.input)
  const reasoningEfforts = effortMap(entry.reasoningEfforts)
  const compat = typeof entry.compat === 'object' && entry.compat !== null && !Array.isArray(entry.compat)
    ? entry.compat as Record<string, unknown>
    : undefined
  return {
    id,
    ...name === undefined ? {} : { name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...input === undefined ? {} : { input },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    ...compat === undefined ? {} : { compat },
  }
}

export function presetKeyCandidates(id: string): string[] {
  const keys: string[] = []
  const normalized = id.trim().toLowerCase()
  const push = (value: string): void => {
    if (value.length > 0 && !keys.includes(value))
      keys.push(value)
  }
  const slash = normalized.lastIndexOf('/')
  push(normalized)
  push(slash >= 0 ? normalized.slice(slash + 1) : normalized)
  const bare = slash >= 0 ? normalized.slice(slash + 1) : normalized
  const segments = bare.split('-')
  for (let end = segments.length - 1; end > 0; end--) {
    const prefix = segments.slice(0, end).join('-')
    if (prefix.length < MIN_PREFIX_LENGTH)
      break
    push(prefix)
  }
  return keys
}

function presetRowOf(table: PresetTable | undefined, id: string): PresetRow | undefined {
  if (table === undefined)
    return undefined
  for (const key of presetKeyCandidates(id)) {
    const row = table[key]
    if (row !== undefined)
      return row
  }
  return undefined
}

/** 后台只给模型 id 时，用第三方目录表补齐容量与模态；后台已声明的事实一律保留。 */
export function withPresetCapacity(
  model: Record<string, unknown>,
  row: PresetRow | undefined,
): Record<string, unknown> {
  if (row === undefined)
    return model
  const [vision, reasoning, maxInput, maxOutput] = row
  return {
    ...model,
    ...model.contextWindow === undefined && maxInput > 0 ? { contextWindow: maxInput } : {},
    ...model.maxTokens === undefined && maxOutput > 0 ? { maxTokens: maxOutput } : {},
    ...model.input === undefined && vision === 1 ? { input: ['text', 'image'] } : {},
    ...model.reasoningEfforts === undefined && reasoning === 1 ? { reasoningEfforts: { ...GRADED_EFFORTS } } : {},
  }
}

export function fillFromPresets(
  grant: GatewayGrant,
  table: PresetTable | undefined,
): GatewayGrant {
  if (table === undefined)
    return grant
  return {
    ...grant,
    models: grant.models.map(model => withPresetCapacity(model, presetRowOf(table, String(model.id)))),
  }
}

export function grantOf(payload: unknown, backend: string): GatewayGrant | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return undefined
  const body = payload as Record<string, unknown>
  const rawModels = Array.isArray(body.models)
    ? body.models
    : Array.isArray(body.data) ? body.data : []
  const seen = new Set<string>()
  const models: Record<string, unknown>[] = []
  for (const candidate of rawModels) {
    const model = modelEntry(candidate)
    if (model === undefined || seen.has(String(model.id)))
      continue
    seen.add(String(model.id))
    models.push(model)
  }
  if (models.length === 0)
    return undefined
  const baseURL = trimmedText(body.baseURL) ?? trimmedText(body.baseUrl) ?? `${backend}${DEFAULT_BASE_URL_SUFFIX}`
  const api = trimmedText(body.api)
  const apiKey = trimmedText(body.apiKey)
  const displayName = trimmedText(body.name) ?? trimmedText(body.displayName) ?? DEFAULT_DISPLAY_NAME
  const headers = headerRecord(body.headers)
  return {
    baseURL,
    api: api !== undefined && PROTOCOLS.has(api) ? api : DEFAULT_API,
    displayName,
    models,
    ...apiKey === undefined ? {} : { apiKey },
    ...headers === undefined ? {} : { headers },
  }
}

export function profileOf(grant: GatewayGrant, keyRef: string): GatewayProfile {
  return {
    displayName: grant.displayName,
    api: grant.api,
    baseURL: grant.baseURL,
    models: grant.models,
    ...grant.apiKey === undefined ? {} : { apiKeyEnv: keyRef },
    ...grant.headers === undefined ? {} : { headers: grant.headers },
  }
}

export function stableTextOf(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort())
      sorted[key] = sortValue(record[key])
    return sorted
  }
  return value
}
