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
  fillFromPresets,
  grantOf,
  modelsUrlOf,
  profileOf,
  stableTextOf,
} from './gateway.utils'
import { modelPresets } from './model-presets'

const SETTINGS_NS = 'llm-pi-ai'

const DEFAULT_MODEL_NS = 'agent-default-model'

const PROVIDER_ROUTE = 'dsh-backend'

const KEY_REF = 'DSH_BACKEND_API_KEY'

const TOKEN_REF = 'DSH_ACCESS_TOKEN'

const FETCH_TIMEOUT_MS = 15_000

const DEFAULT_TICK_MS = 15 * 60 * 1000

let cache: GatewayCache | undefined

let applied = ''

let lastError: string | undefined

let status: GatewayStatus = { enabled: false, provisioned: false, models: 0 }

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
      applied = ''
      cache = undefined
      lastError = undefined
      inflight = Promise.resolve()
      status = { enabled: false, provisioned: false, models: 0 }
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
        if (response.status === 401 || response.status === 403) {
          await revoke(`${url} answered ${response.status}`)
          return { ok: false, applied: true, models: 0, error: `${url} answered ${response.status}` }
        }
        throw new Error(`${url} answered ${response.status}`)
      }
      const body = await response.json()
      const grant = grantOf(body, backend)
      if (grant === undefined) {
        if (carriesEmptyGrant(body)) {
          await revoke()
          return { ok: true, applied: true, models: 0 }
        }
        throw new Error(`${url} carried no usable models`)
      }
      const payload: GatewayCache = { source: url, fetchedAt: new Date().toISOString(), grant }
      cache = payload
      writeCache(payload)
      return await provision(grant, true)
    }
    catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      status = publish(status.models)
      return { ok: false, applied: false, models: status.models, error: lastError }
    }
  },
})

async function boot(): Promise<void> {
  const cached = readCache()
  if (cached !== undefined) {
    cache = cached
    await provision(cached.grant, false).catch(() => undefined)
  }
  await gateway.sync().catch(() => undefined)
}

/**
 * 权威撤销：后台明确回答「这个用户没有可用模型」或未授权时摘掉下发，
 * 与拉取失败不同，这里不能保留旧清单，否则退出登录的客户端还能继续用。
 */
async function revoke(error?: string): Promise<void> {
  lastError = error
  const ours = currentSelection()?.provider === PROVIDER_ROUTE
  await settings().mutate(SETTINGS_NS, [{ op: 'unset', path: ['providers', PROVIDER_ROUTE] }])
  applied = ''
  if (ours) {
    await settings().mutate(DEFAULT_MODEL_NS, [
      { op: 'unset', path: ['provider'] },
      { op: 'unset', path: ['model'] },
    ])
  }
  cache = undefined
  removeCache()
  status = publish(0)
}

async function provision(grant: GatewayGrant, refreshPresets: boolean): Promise<GatewaySyncResult> {
  const filled = fillFromPresets(grant, await presetTable(refreshPresets))
  const profile = profileOf(filled, KEY_REF)
  if (filled.apiKey !== undefined)
    await storeKey(filled.apiKey)
  const shape = stableTextOf(profile)
  const changed = shape !== applied
  if (changed) {
    await settings().mutate(SETTINGS_NS, [{ op: 'set', path: ['providers', PROVIDER_ROUTE], value: profile }])
    applied = shape
  }
  await pinDefaultModel(filled)
  lastError = undefined
  status = publish(profile.models.length)
  return { ok: true, applied: changed, models: profile.models.length }
}

/**
 * 后台钦定默认模型：只在当前默认不在授权清单内时改写，用户自己切过的模型不动。
 * 默认项写失败只降级为告警，不能让模型清单下发跟着一起失败。
 */
async function pinDefaultModel(grant: GatewayGrant): Promise<void> {
  if (grant.defaultModel.length === 0)
    return
  try {
    const current = currentSelection()
    if (current !== undefined && grant.models.some(model => model.id === current.model))
      return
    await settings().mutate(DEFAULT_MODEL_NS, [
      { op: 'set', path: ['provider'], value: PROVIDER_ROUTE },
      { op: 'set', path: ['model'], value: grant.defaultModel },
    ])
  }
  catch (error) {
    console.warn(`[model gateway] default model pin failed: ${error instanceof Error ? error.message : String(error)}`)
  }
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

function publish(models: number): GatewayStatus {
  return {
    enabled: true,
    provisioned: applied.length > 0,
    models,
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

async function storeKey(key: string): Promise<void> {
  const current = await credentials().resolve(KEY_REF)
  if (current?.value === key)
    return
  await credentials().set(KEY_REF, key)
}

function settings(): GatewaySettingsService {
  return getServerContext(server).get('settings') as GatewaySettingsService
}

function credentials(): GatewayCredentialsService {
  // 核心把 ref 定义成品牌类型，运行期就是普通字符串引用名
  return getServerContext(server).get('credentials') as unknown as GatewayCredentialsService
}

function readCache(): GatewayCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(resolveGatewayCachePath(), 'utf8')) as Partial<GatewayCache>
    if (typeof parsed.source !== 'string' || typeof parsed.fetchedAt !== 'string' || parsed.grant === undefined)
      return undefined
    return { source: parsed.source, fetchedAt: parsed.fetchedAt, grant: cachedGrantOf(parsed.grant) }
  }
  catch {
    return undefined
  }
}

/** 旧版本缓存没有 `defaultModel`：从清单首条补出来，缺事实的缓存一律不认。 */
function cachedGrantOf(raw: Partial<GatewayGrant>): GatewayGrant {
  const models = Array.isArray(raw.models)
    ? raw.models.filter((model): model is Record<string, unknown> =>
        typeof model === 'object' && model !== null && typeof (model as { id?: unknown }).id === 'string')
    : []
  const declared = typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : ''
  return {
    baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : '',
    api: typeof raw.api === 'string' ? raw.api : 'openai-completions',
    displayName: typeof raw.displayName === 'string' ? raw.displayName : 'AI Gateway',
    models,
    defaultModel: declared.length > 0 ? declared : String(models[0]?.id ?? ''),
    ...typeof raw.apiKey === 'string' ? { apiKey: raw.apiKey } : {},
    ...raw.headers !== undefined && typeof raw.headers === 'object' ? { headers: raw.headers } : {},
  }
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
