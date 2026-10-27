import type { PresetTable } from '../../shared/model-presets'
import type { GatewayCache, GatewayCredentialsService, GatewayGrant, GatewaySettingsService, GatewayStatus, GatewaySyncResult } from './gateway.types'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { getServerContext } from 'dsh-h3/utils'
import { defineService } from 'dsh-tauri'
import { server } from '../server'
import { resolveGatewayCachePath } from '../utils/paths'
import {
  backendOf,
  carriesEmptyGrant,
  defaultGrantOf,
  FALLBACK_ROUTE,
  fillFromPresets,
  grantsOf,
  keyRefOf,
  modelsUrlOf,
  profileOf,
  routeOfRaw,
  stableTextOf,
} from './gateway.utils'
import { modelPresets } from './model-presets'

const SETTINGS_NS = 'llm-pi-ai'

const DEFAULT_MODEL_NS = 'agent-default-model'

const TOKEN_REF = 'DSH_ACCESS_TOKEN'

const FETCH_TIMEOUT_MS = 15_000

const DEFAULT_TICK_MS = 15 * 60 * 1000

let cache: GatewayCache | undefined

const applied = new Map<string, string>()

let granted: readonly GatewayGrant[] = []

let lastError: string | undefined

let status: GatewayStatus = { enabled: false, provisioned: false, gateways: 0, models: 0 }

let inflight: Promise<unknown> = Promise.resolve()

export const gateway = defineService({
  start(tickMs: number = DEFAULT_TICK_MS): () => void {
    if (backendOf(process.env) === undefined)
      return () => {}
    status = { ...status, enabled: true }
    const interval = tickMs > 0 ? tickMs : DEFAULT_TICK_MS
    inflight = boot()
    const timer = setInterval(() => {
      inflight = inflight.then(() => gateway.sync()).catch(() => undefined)
    }, interval)
    return () => {
      clearInterval(timer)
      applied.clear()
      granted = []
      cache = undefined
      lastError = undefined
      inflight = Promise.resolve()
      status = { enabled: false, provisioned: false, gateways: 0, models: 0 }
    }
  },

  peek(): GatewayStatus {
    return status
  },

  async sync(): Promise<GatewaySyncResult> {
    const backend = backendOf(process.env)
    if (backend === undefined)
      return { ok: false, applied: false, models: status.models, error: 'model backend url is not configured' }
    const url = modelsUrlOf(backend)
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: await requestHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          return await revokeDenied(`${url} answered ${response.status}`)
        throw new Error(`${url} answered ${response.status}`)
      }
      const body = await response.json()
      if (carriesEmptyGrant(body)) {
        await revoke()
        return { ok: true, applied: true, models: 0 }
      }
      const grants = grantsOf(body, backend)
      if (grants === undefined)
        throw new Error(`${url} carried no usable models`)
      cache = { source: url, fetchedAt: new Date().toISOString(), grants }
      writeCache(cache)
      return await provision(grants, true)
    }
    catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      status = publish()
      return { ok: false, applied: false, models: status.models, error: lastError }
    }
  },
})

async function boot(): Promise<void> {
  const cached = readCache()
  if (cached !== undefined) {
    cache = cached
    await provision(cached.grants, false).catch(() => undefined)
  }
  await gateway.sync().catch(() => undefined)
}

/**
 * 单对象版本会在 profile 里留下兜底路由：启动时认领它，数组里没有就照常摘除，
 * 升级后不会留下一条没人负责的网关配置。
 */
function claimFallbackRoute(): void {
  if (applied.has(FALLBACK_ROUTE)) {
    return
  }
  const section = effectiveSection(SETTINGS_NS)
  if (section === null || typeof section !== 'object' || Array.isArray(section))
    return
  const providers = (section as { providers?: Record<string, unknown> }).providers
  if (providers !== undefined && providers[FALLBACK_ROUTE] !== undefined)
    applied.set(FALLBACK_ROUTE, '\u0000legacy')
}

async function provision(grants: readonly GatewayGrant[], refreshPresets: boolean): Promise<GatewaySyncResult> {
  claimFallbackRoute()
  const table = await presetTable(refreshPresets)
  const filled = grants.map(grant => fillFromPresets(grant, table))
  for (const grant of filled) {
    if (grant.apiKey !== undefined)
      await storeKey(keyRefOf(grant.route), grant.apiKey)
  }
  let changed = false
  for (const grant of filled) {
    const profile = profileOf(grant)
    const shape = stableTextOf(profile)
    if (applied.get(grant.route) === shape)
      continue
    await settings().mutate(SETTINGS_NS, [{ op: 'set', path: ['providers', grant.route], value: profile }])
    applied.set(grant.route, shape)
    changed = true
  }
  for (const route of [...applied.keys()]) {
    if (filled.some(grant => grant.route === route))
      continue
    await settings().mutate(SETTINGS_NS, [{ op: 'unset', path: ['providers', route] }])
    applied.delete(route)
    changed = true
  }
  await pinDefaultModel(filled)
  lastError = undefined
  granted = filled
  status = publish()
  return { ok: true, applied: changed, models: status.models }
}

/**
 * 权威撤销：后台明确回答「这个用户没有可用模型」或未授权时摘掉全部下发，
 * 与拉取失败不同，这里不能保留旧清单，否则退出登录的客户端还能继续用。
 */
async function revoke(): Promise<void> {
  const provider = currentSelection()?.provider
  const ours = provider !== undefined && applied.has(provider)
  for (const route of [...applied.keys()])
    await settings().mutate(SETTINGS_NS, [{ op: 'unset', path: ['providers', route] }])
  applied.clear()
  granted = []
  if (ours) {
    await settings().mutate(DEFAULT_MODEL_NS, [
      { op: 'unset', path: ['provider'] },
      { op: 'unset', path: ['model'] },
    ])
  }
  cache = undefined
  removeCache()
  status = publish()
}

async function revokeDenied(error: string): Promise<GatewaySyncResult> {
  await revoke()
  lastError = error
  status = publish()
  return { ok: false, applied: true, models: 0, error }
}

/**
 * 后台钦定默认模型：只在当前默认不在授权清单内时改写，用户自己切过的模型不动。
 * 默认项写失败只降级为告警，不能让模型清单下发跟着一起失败。
 */
async function pinDefaultModel(grants: readonly GatewayGrant[]): Promise<void> {
  const target = defaultGrantOf(grants)
  if (target === undefined || target.defaultModel.length === 0)
    return
  try {
    if (defaultStillOwned(grants, currentSelection())) {
      return
    }
    await settings().mutate(DEFAULT_MODEL_NS, [
      { op: 'set', path: ['provider'], value: target.route },
      { op: 'set', path: ['model'], value: target.defaultModel },
    ])
  }
  catch (error) {
    console.warn(`[model gateway] default model pin failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function publish(): GatewayStatus {
  return {
    enabled: true,
    provisioned: applied.size > 0,
    gateways: applied.size,
    models: granted.reduce((total, grant) => total + grant.models.length, 0),
    ...cache === undefined ? {} : { fetchedAt: cache.fetchedAt },
    ...lastError === undefined ? {} : { error: lastError },
  }
}

async function presetTable(refresh: boolean): Promise<PresetTable | undefined> {
  const resolved = await modelPresets.resolve(refresh)
  return resolved.ok ? resolved.presets : undefined
}

async function requestHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const token = await accessToken()
  if (token !== undefined)
    headers.authorization = `Bearer ${token}`
  return headers
}

async function accessToken(): Promise<string | undefined> {
  try {
    const hit = await credentials().resolve(TOKEN_REF)
    const value = typeof hit?.value === 'string' ? hit.value.trim() : ''
    return value.length === 0 ? undefined : value
  }
  catch {
    return undefined
  }
}

async function storeKey(ref: string, key: string): Promise<void> {
  const current = await credentials().resolve(ref)
  if (current?.value === key)
    return
  await credentials().set(ref, key)
}

function settings(): GatewaySettingsService {
  return getServerContext(server).get('settings') as GatewaySettingsService
}

function credentials(): GatewayCredentialsService {
  // 核心把 ref 定义成品牌类型，运行期就是普通字符串引用名
  return getServerContext(server).get('credentials') as unknown as GatewayCredentialsService
}

/** 用户当前用的模型仍在授权网关里时不抢改默认；上游被摘掉则重新钦定。 */
function defaultStillOwned(grants: readonly GatewayGrant[], current?: { provider?: string, model?: string }): boolean {
  if (current?.model === undefined)
    return false
  const kept = new Set(grants.map(grant => grant.route))
  if (current.provider !== undefined && !kept.has(current.provider))
    return false
  return grants.some(grant => (current.provider === undefined || grant.route === current.provider)
    && grant.models.some(model => model.id === current.model))
}

function currentSelection(): { provider?: string, model?: string } | undefined {
  try {
    const section = effectiveSection(DEFAULT_MODEL_NS)
    if (section === null || typeof section !== 'object' || Array.isArray(section))
      return undefined
    const selection = section as { provider?: unknown, model?: unknown }
    return {
      ...typeof selection.provider === 'string' ? { provider: selection.provider } : {},
      ...typeof selection.model === 'string' ? { model: selection.model } : {},
    }
  }
  catch {
    return undefined
  }
}

/** 必须读合并后的生效值：`get(ns)` 只给 bundle/base 层，看不到写进 profile 的配置。 */
function effectiveSection(ns: string): unknown {
  const service = settings()
  if (typeof service.describe === 'function') {
    const entry = service.describe().find(item => item.ns === ns)
    if (entry !== undefined)
      return entry.value
  }
  return service.get(ns)
}

function readCache(): GatewayCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(resolveGatewayCachePath(), 'utf8')) as Record<string, unknown>
    if (typeof parsed.source !== 'string' || typeof parsed.fetchedAt !== 'string')
      return undefined
    const raw = Array.isArray(parsed.grants) ? parsed.grants : parsed.grant === undefined ? [] : [parsed.grant]
    const grants = raw.map((entry, index) => cachedGrantOf(entry, index)).filter((grant): grant is GatewayGrant => grant !== undefined)
    if (grants.length === 0)
      return undefined
    return { source: parsed.source, fetchedAt: parsed.fetchedAt, grants }
  }
  catch {
    return undefined
  }
}

/** 缓存里缺 `defaultModel` 的旧条目按首条补；没有可用模型的条目一律不认。 */
function cachedGrantOf(raw: unknown, index: number): GatewayGrant | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    return undefined
  const entry = raw as Partial<GatewayGrant> & Record<string, unknown>
  const models = Array.isArray(entry.models)
    ? entry.models.filter((model): model is Record<string, unknown> =>
        typeof model === 'object' && model !== null && typeof (model as { id?: unknown }).id === 'string')
    : []
  if (models.length === 0 || typeof entry.baseURL !== 'string')
    return undefined
  const declared = typeof entry.defaultModel === 'string' ? entry.defaultModel.trim() : ''
  return {
    route: typeof entry.route === 'string' && entry.route.length > 0 ? entry.route : routeOfRaw(raw, index),
    baseURL: entry.baseURL,
    api: typeof entry.api === 'string' ? entry.api : 'openai-completions',
    displayName: typeof entry.displayName === 'string' ? entry.displayName : 'AI Gateway',
    models,
    defaultModel: declared.length > 0 ? declared : String(models[0]?.id ?? ''),
    declaresDefault: entry.declaresDefault === true,
    ...typeof entry.apiKey === 'string' ? { apiKey: entry.apiKey } : {},
    ...isRecord(entry.headers) ? { headers: entry.headers } : {},
  }
}

function isRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function removeCache(): void {
  try {
    rmSync(resolveGatewayCachePath(), { force: true })
  }
  catch {
  }
}

function writeCache(payload: GatewayCache): void {
  try {
    const path = resolveGatewayCachePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(payload))
  }
  catch {
  }
}
