import type { PresetRow, PresetTable } from '../../shared/model-presets'
import type { GatewayGrant, GatewayProfile } from './gateway.types'

const MODELS_PATH = '/api/model-provider/config'

const DEFAULT_API = 'openai-completions'

const DEFAULT_BASE_URL_SUFFIX = '/api/v1'

const DEFAULT_DISPLAY_NAME = 'AI Gateway'

export const FALLBACK_ROUTE = 'dsh-backend'

const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

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

/** 与官方设置页同一套引用名推导，后台换网关时凭据不会互相覆盖。 */
export function keyRefOf(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

function routeOf(body: Record<string, unknown>, declaredName: string | undefined, index: number): string {
  const declared = trimmedText(body.route)?.toLowerCase()
  if (declared !== undefined && ROUTE_PATTERN.test(declared))
    return declared
  const slug = declaredName?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug !== undefined && ROUTE_PATTERN.test(slug))
    return slug
  return index === 0 ? FALLBACK_ROUTE : `${FALLBACK_ROUTE}-${index + 1}`
}

/** 旧版暂存条目没有 `route`：按同一套规则补出来，好让升级后还能认领并摘除它。 */
export function routeOfRaw(raw: unknown, index: number): string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return index === 0 ? FALLBACK_ROUTE : `${FALLBACK_ROUTE}-${index + 1}`
  const body = raw as Record<string, unknown>
  return routeOf(body, trimmedText(body.name) ?? trimmedText(body.displayName), index)
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
  const bare = slash >= 0 ? normalized.slice(slash + 1) : normalized
  push(normalized)
  push(bare)
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

/**
 * 后台返回网关数组（也兼容单个对象）：数组就是全量权威，
 * 单个元素畸形只丢它自己，不把整批下发一起带走。
 */
export function grantsOf(payload: unknown, backend: string): GatewayGrant[] | undefined {
  const entries = gatewayEntriesOf(payload)
  const grants: GatewayGrant[] = []
  const taken = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const grant = grantOf(entry, backend, index)
    if (grant === undefined || taken.has(grant.route))
      continue
    taken.add(grant.route)
    grants.push(grant)
  }
  return grants.length === 0 ? undefined : grants
}

/**
 * 载荷形态三选一：网关数组、单个网关对象、`{code,msg,data}` 信封。
 * 信封里的 `data` 只有在元素本身是网关对象时才当清单用，否则退回 OpenAI 风格的 models。
 */
function gatewayEntriesOf(payload: unknown): readonly unknown[] {
  if (Array.isArray(payload))
    return payload
  if (payload === null || typeof payload !== 'object')
    return [payload]
  const body = payload as Record<string, unknown>
  const wrapped = unwrapData(body)
  return wrapped === undefined ? [body] : wrapped
}

function unwrapData(body: Record<string, unknown>): readonly unknown[] | undefined {
  const data = body.data
  if (!Array.isArray(data))
    return undefined
  if (data.some(entry => isGatewayEntry(entry)))
    return data
  if (body.models === undefined && !isModelEntry(data[0]))
    return data
  return undefined
}

function isGatewayEntry(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const entry = value as Record<string, unknown>
  return Array.isArray(entry.models) || Array.isArray(entry.data)
    || trimmedText(entry.route) !== undefined || trimmedText(entry.baseURL) !== undefined
}

function isModelEntry(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && !Array.isArray(entry.models)
}

function grantOf(payload: unknown, backend: string, index: number): GatewayGrant | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return undefined
  const body = payload as Record<string, unknown>
  const rawModels = Array.isArray(body.models)
    ? body.models
    : Array.isArray(body.data) ? body.data : []
  const seen = new Set<string>()
  const models: Record<string, unknown>[] = []
  let flagged: string | undefined
  for (const candidate of rawModels) {
    const model = modelEntry(candidate)
    if (model === undefined || seen.has(String(model.id)))
      continue
    seen.add(String(model.id))
    if (flagged === undefined && (candidate as { default?: unknown }).default === true)
      flagged = String(model.id)
    models.push(model)
  }
  if (models.length === 0)
    return undefined
  const baseURL = trimmedText(body.baseURL) ?? trimmedText(body.baseUrl) ?? `${backend}${DEFAULT_BASE_URL_SUFFIX}`
  const api = trimmedText(body.api)
  const apiKey = trimmedText(body.apiKey)
  const declaredName = trimmedText(body.name) ?? trimmedText(body.displayName)
  const headers = headerRecord(body.headers)
  return {
    route: routeOf(body, declaredName, index),
    baseURL,
    api: api !== undefined && PROTOCOLS.has(api) ? api : DEFAULT_API,
    displayName: declaredName ?? DEFAULT_DISPLAY_NAME,
    models,
    defaultModel: defaultModelOf(body, models.map(model => String(model.id)), flagged),
    declaresDefault: declaresDefault(body, flagged),
    ...apiKey === undefined ? {} : { apiKey },
    ...headers === undefined ? {} : { headers },
  }
}

/** 后台钦定的默认模型：顶层声明优先，其次首个 `default: true`，都没有就用第一条。 */
function defaultModelOf(body: Record<string, unknown>, ids: readonly string[], flagged: string | undefined): string {
  const declared = trimmedText(body.defaultModel) ?? trimmedText(body.default)
  if (declared !== undefined && ids.includes(declared))
    return declared
  return flagged ?? String(ids[0] ?? '')
}

function declaresDefault(body: Record<string, unknown>, flagged: string | undefined): boolean {
  return flagged !== undefined || body.defaultModel !== undefined || body.default !== undefined
}

export function profileOf(grant: GatewayGrant): GatewayProfile {
  return {
    displayName: grant.displayName,
    api: grant.api,
    baseURL: grant.baseURL,
    models: grant.models,
    ...grant.apiKey === undefined ? {} : { apiKeyEnv: keyRefOf(grant.route) },
    ...grant.headers === undefined ? {} : { headers: grant.headers },
  }
}

/** 多个网关时只认显式钦定：谁标了默认就用谁，都没标就按数组顺序取第一个。 */
export function defaultGrantOf(grants: readonly GatewayGrant[]): GatewayGrant | undefined {
  return grants.find(grant => grant.declaresDefault) ?? grants[0]
}

/** 后台明确回答「一个模型都没有」，与载荷畸形要区分开：前者是权威撤销。 */
export function carriesEmptyGrant(payload: unknown): boolean {
  if (Array.isArray(payload))
    return payload.length === 0
  if (typeof payload !== 'object' || payload === null)
    return false
  const body = payload as Record<string, unknown>
  if (Array.isArray(body.models))
    return body.models.length === 0
  return Array.isArray(body.data) && body.data.length === 0
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
