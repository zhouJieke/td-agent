import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
let defaultSelection: Record<string, string>
let credentialSets: string[]
let httpServers: ReturnType<typeof createServer>[]

function profileWrites(): ProfileWrite[] {
  return writes.filter(write => write.ns === 'llm-pi-ai')
}

function defaultWrites(): ProfileWrite[] {
  return writes.filter(write => write.ns === 'agent-default-model')
}

function writtenRoutes(): string[] {
  return profileWrites().flatMap(write => write.ops
    .filter(op => op.op === 'set')
    .map(op => String(op.path[1])))
}

function unsetRoutes(): string[] {
  return profileWrites().flatMap(write => write.ops
    .filter(op => op.op === 'unset')
    .map(op => String(op.path[1])))
}

async function loadModule(): Promise<void> {
  vi.resetModules()
  const [{ gateway: loaded }, { server }] = await Promise.all([import('./gateway'), import('../server')])
  gateway = loaded
  writes = []
  credentialSets = []
  httpServers = []
  stored = { DSH_ACCESS_TOKEN: 'admin-token' }
  defaultSelection = { provider: 'deepseek-official', model: 'deepseek-flash' }
  bindHost = () => {
    const settingsService = {
      get: (ns: string) => ns === 'agent-default-model' ? { ...defaultSelection } : {},
      describe: () => [
        { ns: 'llm-pi-ai', value: {} },
        { ns: 'agent-default-model', value: { ...defaultSelection } },
      ],
      mutate: async (ns: string, ops: ProfileWrite['ops']) => {
        writes.push({ ns, ops })
        if (ns !== 'agent-default-model')
          return
        for (const op of ops) {
          if (op.op === 'set' && typeof op.value === 'string')
            defaultSelection[String(op.path[0])] = op.value
        }
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
    grants: [{
      route: 'cached-gw',
      baseURL: `${baseURL}/api/v1`,
      api: 'openai-completions',
      displayName: 'Cached Gateway',
      models: [{ id: 'cached-model', contextWindow: 32_000 }],
      defaultModel: 'cached-model',
      declaresDefault: false,
    }],
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
    expect(profileWrites()[0]?.ops[0]).toMatchObject({
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
    expect(defaultWrites()[0]?.ops).toEqual([
      { op: 'set', path: ['provider'], value: 'dsh-backend' },
      { op: 'set', path: ['model'], value: 'deepseek-v3' },
    ])
    expect(gateway.peek()).toMatchObject({ enabled: true, provisioned: true, gateways: 1, models: 2 })
  })

  it('provisions every gateway in the array with its own credential reference', async () => {
    const backend = await listen([
      { route: 'company-gw', apiKey: 'sk-a', models: [{ id: 'm-a' }] },
      { route: 'vendor-b', api: 'anthropic-messages', apiKey: 'sk-b', models: [{ id: 'm-b', default: true }] },
    ])
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true, models: 2 })
    expect(writtenRoutes()).toEqual(['company-gw', 'vendor-b'])
    expect(credentialSets).toEqual(['COMPANY_GW_API_KEY', 'VENDOR_B_API_KEY'])
    expect(defaultWrites()[0]?.ops).toEqual([
      { op: 'set', path: ['provider'], value: 'vendor-b' },
      { op: 'set', path: ['model'], value: 'm-b' },
    ])
    expect(gateway.peek()).toMatchObject({ gateways: 2, models: 2 })
  })

  it('re-pins the default when its own gateway disappears under a shared model name', async () => {
    const backend = await listen([{ route: 'a', models: [{ id: 'shared-model' }] }])
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    expect(defaultWrites().at(-1)?.ops).toEqual([
      { op: 'set', path: ['provider'], value: 'a' },
      { op: 'set', path: ['model'], value: 'shared-model' },
    ])

    const moved = await listen([{ route: 'b', models: [{ id: 'shared-model' }] }])
    process.env.DSH_MODEL_BACKEND_URL = moved
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    expect(unsetRoutes()).toEqual(['a'])
    expect(defaultWrites().at(-1)?.ops).toEqual([
      { op: 'set', path: ['provider'], value: 'b' },
      { op: 'set', path: ['model'], value: 'shared-model' },
    ])
  })

  it('provisions a legacy cache entry that carries no route and unsets it later', async () => {
    mkdirSync(join(home, 'dsh-tauri-model'), { recursive: true })
    writeFileSync(resolveGatewayCachePath(), JSON.stringify({
      source: 'https://gw.example.com/api/ai/models',
      fetchedAt: '2026-10-20T00:00:00.000Z',
      grant: {
        baseURL: 'https://gw.example.com/api/v1',
        api: 'openai-completions',
        displayName: '公司网关',
        models: [{ id: 'legacy-model' }],
      },
    }))
    const backend = await listen([{ route: 'ali-chat', models: [{ id: 'm' }] }])
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    const stop = gateway.start(60_000)
    await vi.waitFor(() => expect(unsetRoutes()).toEqual(['dsh-backend']), { timeout: 4_000 })
    expect(writtenRoutes()).toEqual(['dsh-backend', 'ali-chat'])
    stop()
  })

  it('unsets the gateway that disappeared from the array', async () => {
    const backend = await listen([
      { route: 'stay', models: [{ id: 'm-1' }] },
      { route: 'leave', models: [{ id: 'm-2' }] },
    ])
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    const trimmed = await listen([{ route: 'stay', models: [{ id: 'm-1' }] }])
    process.env.DSH_MODEL_BACKEND_URL = trimmed
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true, applied: true })
    expect(unsetRoutes()).toEqual(['leave'])
    expect(gateway.peek()).toMatchObject({ gateways: 1 })
  })

  it('sends the login token to the granting interface', async () => {
    const rawHeaders: string[] = []
    const http = createServer((request, response) => {
      rawHeaders.push(...request.rawHeaders)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify([{ models: [{ id: 'm' }] }]))
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
    expect(profileWrites()).toHaveLength(1)
    expect(defaultWrites()).toHaveLength(1)
  })

  it('keeps the last grant when the backend refuses and reports the failure', async () => {
    const backend = await listen({ models: [{ id: 'm' }] })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    const failing = await listen([], 503)
    process.env.DSH_MODEL_BACKEND_URL = failing
    const result = await gateway.sync()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('answered 503')
    expect(gateway.peek()).toMatchObject({ provisioned: true, error: expect.stringContaining('answered 503') })
    expect(profileWrites()).toHaveLength(1)
  })

  it('revokes the grant when the backend grants this user nothing', async () => {
    const backend = await listen({ models: [{ id: 'm' }] })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })
    expect(existsSync(resolveGatewayCachePath())).toBe(true)

    const empty = await listen([])
    process.env.DSH_MODEL_BACKEND_URL = empty
    await expect(gateway.sync()).resolves.toEqual({ ok: true, applied: true, models: 0 })
    expect(unsetRoutes()).toEqual(['dsh-backend'])
    expect(defaultWrites().at(-1)?.ops).toEqual([
      { op: 'unset', path: ['provider'] },
      { op: 'unset', path: ['model'] },
    ])
    expect(existsSync(resolveGatewayCachePath())).toBe(false)
    expect(gateway.peek()).toMatchObject({ enabled: true, provisioned: false, models: 0 })
  })

  it('drops everything on an unauthorized answer so a logged-out client keeps no models', async () => {
    const backend = await listen({ models: [{ id: 'm' }] })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true })

    const denied = await listen([], 401)
    process.env.DSH_MODEL_BACKEND_URL = denied
    await expect(gateway.sync()).resolves.toMatchObject({ ok: false, applied: true, models: 0 })
    expect(unsetRoutes()).toEqual(['dsh-backend'])
    expect(gateway.peek()).toMatchObject({ provisioned: false, error: expect.stringContaining('answered 401') })
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
    expect(gateway.peek()).toEqual({ enabled: false, provisioned: false, gateways: 0, models: 0 })
  })
})

describe('gateway.start', () => {
  it('provisions the cached grant before the backend is reachable again', async () => {
    const dead = await listen([], 500)
    seedCache(dead)
    process.env.DSH_MODEL_BACKEND_URL = dead
    bindHost()
    const stop = gateway.start(60_000)
    await vi.waitFor(() => expect(writtenRoutes()).toEqual(['cached-gw']), { timeout: 4_000 })
    expect(profileWrites()[0]?.ops[0]?.value).toMatchObject({
      baseURL: `${dead}/api/v1`,
      models: [{ id: 'cached-model', contextWindow: 32_000 }],
    })
    expect(defaultWrites()[0]?.ops).toEqual([
      { op: 'set', path: ['provider'], value: 'cached-gw' },
      { op: 'set', path: ['model'], value: 'cached-model' },
    ])
    stop()
  })

  it('leaves the default alone once the session picked another granted model', async () => {
    const backend = await listen({ models: [{ id: 'm-a' }, { id: 'm-b' }] })
    process.env.DSH_MODEL_BACKEND_URL = backend
    bindHost()
    defaultSelection.provider = 'dsh-backend'
    defaultSelection.model = 'm-b'
    await expect(gateway.sync()).resolves.toMatchObject({ ok: true, models: 2 })
    expect(defaultWrites()).toHaveLength(0)
  })

  it('stays idle without a configured domain', async () => {
    bindHost()
    gateway.start(60_000)()
    expect(writes).toHaveLength(0)
    expect(gateway.peek()).toEqual({ enabled: false, provisioned: false, gateways: 0, models: 0 })
  })
})
