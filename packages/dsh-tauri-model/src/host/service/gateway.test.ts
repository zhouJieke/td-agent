import type { AddressInfo } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveGatewayCachePath } from '../utils/paths'

vi.mock('./model-presets', () => ({
  modelPresets: {
    resolve: async () => ({
      ok: true as const,
      stale: false,
      source: 'test',
      fetchedAt: '2026-10-23T00:00:00.000Z',
      presets: { 'deepseek-v3': [1, 0, 64_000, 8192] },
    }),
  },
}))

type Gateway = typeof import('./gateway').gateway

interface ProfileWrite {
  ns: string
  ops: { op: string, path: readonly string[], value?: unknown }[]
}

let gateway: Gateway
let bindHost: () => void
let home: string
let writes: ProfileWrite[]
let stored: Record<string, string>
let credentialSets: string[]
let httpServers: ReturnType<typeof createServer>[]

async function loadModule(): Promise<void> {
  vi.resetModules()
  const [{ gateway: loaded }, { server }] = await Promise.all([import('./gateway'), import('../server')])
  gateway = loaded
  writes = []
  credentialSets = []
  httpServers = []
  stored = { DSH_ACCESS_TOKEN: 'admin-token' }
  bindHost = () => {
    const settingsService = {
      mutate: async (ns: string, ops: ProfileWrite['ops']) => {
        writes.push({ ns, ops })
      },
    }
    const credentialsService = {
      resolve: async (ref: string) => stored[ref] === undefined ? undefined : { value: stored[ref] },
      set: async (ref: string, value: string) => {
        credentialSets.push(ref)
        stored[ref] = value
      },
    }
    server({
      get: (name: string) => name === 'settings' ? settingsService : credentialsService,
      webServer: { register: () => () => {} },
    } as never)
  }
}

async function listen(payload: unknown, status = 200): Promise<string> {
  const http = createServer((_request, response) => {
    if (status !== 200) {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'denied' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
  httpServers.push(http)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()))
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`
}

function seedCache(baseURL: string): void {
  mkdirSync(join(home, 'dsh-tauri-model'), { recursive: true })
  writeFileSync(resolveGatewayCachePath(), JSON.stringify({
    source: `${baseURL}/api/ai/models`,
    fetchedAt: '2026-10-20T00:00:00.000Z',
    grant: {
      baseURL: `${baseURL}/api/v1`,
      api: 'openai-completions',
      displayName: 'AI Gateway',
      models: [{ id: 'cached-model', contextWindow: 32_000 }],
    },
  }))
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-gateway-'))
  process.env.DSH_HOME = home
  await loadModule()
})

afterEach(async () => {
  await Promise.all(httpServers.splice(0).map(http => new Promise<void>(resolve => http.close(() => resolve()))))
  rmSync(home, { recursive: true, force: true })
  delete process.env.DSH_HOME
  delete process.env.DSH_MODEL_BACKEND_URL
})

describe('gateway.sync', () => {
  it('writes the granted models as one gateway provider profile and stores its key', async () => {
    const backend = await listen({
      apiKey: 'sk-granted',
      models: [{ id: 'deepseek-v3' }, { id: 'internal-llm', name: '内网模型', contextWindow: 200_000 }],
    })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toEqual({ ok: true, applied: true, models: 2 })
    expect(writes[0]?.ns).toBe('llm-pi-ai')
    expect(writes[0]?.ops[0]).toMatchObject({
      op: 'set',
      path: ['providers', 'dsh-backend'],
      value: {
        displayName: 'AI Gateway',
        api: 'openai-completions',
        baseURL: `${backend}/api/v1`,
        apiKeyEnv: 'DSH_BACKEND_API_KEY',
        models: [
          { id: 'deepseek-v3', contextWindow: 64_000, maxTokens: 8192, input: ['text', 'image'] },
          { id: 'internal-llm', name: '内网模型', contextWindow: 200_000 },
        ],
      },
    })
    expect(credentialSets).toEqual(['DSH_BACKEND_API_KEY'])
    expect(gateway.peek()).toMatchObject({ enabled: true, provisioned: true, models: 2 })
  })

  it('sends the login token to the granting interface', async () => {
    const rawHeaders: string[] = []
    const http = createServer((request, response) => {
      rawHeaders.push(...request.rawHeaders)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ models: [{ id: 'm' }] }))
    })
    httpServers.push(http)
    await new Promise<void>(resolve => http.listen(0, '127.0.0.1', () => resolve()))
    process.env.DSH_MODEL_BACKEND_URL = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    const index = rawHeaders.findIndex(header => header.toLowerCase() === 'authorization')
    expect(rawHeaders[index + 1]).toBe('Bearer admin-token')
  })

  it('skips the settings write while the projected profile is unchanged', async () => {
    const backend = await listen({ models: [{ id: 'm' }] })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ applied: true })
    await expect(gateway.sync()).resolves.toMatchObject({ applied: false, models: 1 })
    expect(writes).toHaveLength(1)
  })

  it('keeps the last grant when the backend refuses and reports the failure', async () => {
    const backend = await listen({ models: [{ id: 'm' }] })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    const failing = await listen({}, 503)
    process.env.DSH_MODEL_BACKEND_URL = failing
    const result = await gateway.sync()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('answered 503')
    expect(gateway.peek()).toMatchObject({ provisioned: true, error: expect.stringContaining('answered 503') })
    expect(writes).toHaveLength(1)
  })

  it('writes nothing when no backend domain is configured', async () => {
    bindHost()
    await expect(gateway.sync()).resolves.toEqual({
      ok: false,
      applied: false,
      models: 0,
      error: 'model backend url is not configured',
    })
    expect(writes).toHaveLength(0)
    expect(gateway.peek()).toEqual({ enabled: false, provisioned: false, models: 0 })
  })
})

describe('gateway.start', () => {
  it('provisions the cached grant before the backend is reachable again', async () => {
    const dead = await listen({}, 500)
    seedCache(dead)
    process.env.DSH_MODEL_BACKEND_URL = dead
    bindHost()
    const stop = gateway.start(60_000)
    await vi.waitFor(() => expect(writes).toHaveLength(1), { timeout: 4_000 })
    expect(writes[0]?.ops[0]?.value).toMatchObject({
      baseURL: `${dead}/api/v1`,
      models: [{ id: 'cached-model', contextWindow: 32_000 }],
    })
    stop()
  })

  it('stays idle without a configured domain', async () => {
    bindHost()
    gateway.start(60_000)()
    expect(writes).toHaveLength(0)
    expect(gateway.peek()).toEqual({ enabled: false, provisioned: false, models: 0 })
  })
})
