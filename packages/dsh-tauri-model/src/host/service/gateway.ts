import type { PresetTable } from '../../shared/model-presets'
import type { GatewayCache, GatewayCredentialsService, GatewayGrant, GatewaySettingsService, GatewayStatus, GatewaySyncResult } from './gateway.types'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { getServerContext } from 'dsh-h3/utils'
import { defineService } from 'dsh-tauri'
import { server } from '../server'
import { resolveGatewayCachePath } from '../utils/paths'
import {
  backendOf,
  fillFromPresets,
  grantOf,
  modelsUrlOf,
  profileOf,
  stableTextOf,
} from './gateway.utils'
import { modelPresets } from './model-presets'

const SETTINGS_NS = 'llm-pi-ai'

const PROVIDER_ROUTE = 'dsh-backend'

const KEY_REF = 'DSH_BACKEND_API_KEY'

const TOKEN_REF = 'DSH_ACCESS_TOKEN'

const FETCH_TIMEOUT_MS = 15_000

const DEFAULT_TICK_MS = 15 * 60 * 1000

let cache: GatewayCache | undefined

let applied = ''

let lastError: string | undefined

let status: GatewayStatus = { enabled: false, provisioned: false, models: 0 }

export const gateway = defineService({
  start(tickMs: number = DEFAULT_TICK_MS): () => void {
    if (backendOf(process.env) === undefined)
      return () => {}
    status = { ...status, enabled: true }
    const cached = readCache()
    if (cached !== undefined) {
      cache = cached
      void provision(cached.grant, false).catch(() => undefined)
    }
    void gateway.sync().catch(() => undefined)
    const interval = tickMs > 0 ? tickMs : DEFAULT_TICK_MS
    const timer = setInterval(() => {
      void gateway.sync().catch(() => undefined)
    }, interval)
    return () => {
      clearInterval(timer)
      applied = ''
      cache = undefined
      lastError = undefined
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
      if (!response.ok)
        throw new Error(`${url} answered ${response.status}`)
      const grant = grantOf(await response.json(), backend)
      if (grant === undefined)
        throw new Error(`${url} carried no usable models`)
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
  lastError = undefined
  status = publish(profile.models.length)
  return { ok: true, applied: changed, models: profile.models.length }
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
    return { source: parsed.source, fetchedAt: parsed.fetchedAt, grant: parsed.grant }
  }
  catch {
    return undefined
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
