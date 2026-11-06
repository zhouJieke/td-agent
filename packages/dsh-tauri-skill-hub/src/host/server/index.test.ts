import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { SkillHubHost } from '../service/local-skill.types'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as skillHub from '../../index'
import { localSkill } from '../service/local-skill'

const fixture = vi.hoisted(() => ({ home: '' }))

vi.mock('dsh-tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dsh-tauri')>()
  return {
    ...actual,
    get DSH_HOME() {
      return fixture.home
    },
  }
})

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('@deepseek-ai/dsh-skill-filesystem'))
const { default: SkillRegistry, isUserInvocable, renderSkillContent } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-skill')).href)
const path = '/api/tauri/skill-hub/local-skill'

let home: string
let listener: Server | undefined
let context: Context | undefined
let host: Context | undefined

async function start(skills?: SkillHubHost['skills'], rejection?: 401 | 403): Promise<string> {
  const routes = new Map<string, WebRoute>()
  host = new Context()
  await host.plugin({
    name: 'skill-hub-test-services',
    apply(ctx) {
      ctx.provide('webServer', {
        register(route: WebRoute) {
          const key = `${route.kind}\u0000${route.path}`
          routes.set(key, route)
          return () => routes.delete(key)
        },
      })
      ctx.provide('connection', { requestRejection: () => rejection })
      if (skills !== undefined)
        ctx.provide('skills', skills)
    },
  }).await()
  await host.plugin(skillHub).await()
  listener = createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.get(`exact\u0000${pathname}`)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    Promise.resolve(route.handler(request, response)).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500)
        response.end()
      }
    })
  })
  await new Promise<void>(done => listener!.listen(0, '127.0.0.1', done))
  return `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-skill-hub-test-'))
  fixture.home = home
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (listener !== undefined) {
    await new Promise<void>((done, reject) => listener!.close(error => error ? reject(error) : done()))
    listener = undefined
  }
  if (host !== undefined) {
    await host.fiber.dispose()
    host = undefined
  }
  if (context !== undefined) {
    await context.fiber.dispose()
    context = undefined
  }
  if (dirname(home) !== resolve(tmpdir()) || !basename(home).startsWith('dsh-skill-hub-test-'))
    throw new Error(`Unexpected test directory: ${home}`)
  rmSync(home, { recursive: true, force: true })
})

describe('本地技能加载确认', () => {
  it('真实内核提供者发现新安装技能，并识别优先级更高的同名技能', async () => {
    const root = join(home, 'skills')
    context = new Context()
    const registry = new SkillRegistry(context)
    await context.plugin(filesystem, {
      dshHome: home,
      agentsHome: join(home, 'agents'),
      bundledSkillDir: join(home, 'bundled'),
    }).await()
    const base = await start(registry)

    expect(await registry.get('demo')).toBeUndefined()
    const directory = join(root, 'demo')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'SKILL.md'), '---\nname: demo\ndescription: Demonstration\n---\nFollow the instructions.\n')
    writeFileSync(join(directory, 'resource.txt'), 'resource')

    const loaded = await fetch(`${base}${path}?name=demo`)
    expect(loaded.status).toBe(200)
    expect(await loaded.json()).toEqual({ status: 'ready' })
    const skill = await registry.get('demo')
    expect(skill).toMatchObject({
      name: 'demo',
      source: 'user-dsh',
      invocation: { userInvocable: true },
      content: 'Follow the instructions.',
      resourceBase: { kind: 'directory', path: directory },
    })
    expect(isUserInvocable(skill)).toBe(true)
    expect(renderSkillContent(skill)).toContain('Follow the instructions.')

    registry.register({ name: 'demo', description: 'Higher priority', source: 'runtime', content: 'other' })
    const shadowed = await fetch(`${base}${path}?name=demo`)
    expect(await shadowed.json()).toEqual({ status: 'shadowed' })
  })

  it('同属用户目录但来自不同路径的同名技能不会误判为已加载', async () => {
    const expected = join(home, 'skills', 'demo')
    const other = join(home, 'skills', 'other')
    mkdirSync(expected, { recursive: true })
    mkdirSync(other, { recursive: true })
    const base = await start({
      get: async () => ({
        source: 'user-dsh',
        resourceBase: { kind: 'directory', path: other },
        invocation: { userInvocable: true },
      }),
    })

    const response = await fetch(`${base}${path}?name=demo`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'shadowed' })
  })

  it('技能目录是同一真实路径时，Windows 路径大小写差异不影响加载确认', async () => {
    const directory = join(home, 'skills', 'demo')
    mkdirSync(directory, { recursive: true })
    const base = await start({
      get: async () => ({
        source: 'user-dsh',
        resourceBase: { kind: 'directory', path: process.platform === 'win32' ? directory.toUpperCase() : directory },
        invocation: { userInvocable: true },
      }),
    })

    const response = await fetch(`${base}${path}?name=demo`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  it('内核禁止命令调用时返回不可调用状态', async () => {
    const directory = join(home, 'skills', 'demo')
    mkdirSync(directory, { recursive: true })
    const base = await start({
      get: async () => ({
        source: 'user-dsh',
        resourceBase: { kind: 'directory', path: directory },
        invocation: { userInvocable: false },
      }),
    })

    const response = await fetch(`${base}${path}?name=demo`)

    expect(await response.json()).toEqual({ status: 'not-invocable' })
  })

  it('内核服务缺失时返回不可确认，非法名称及未声明方法被拒绝', async () => {
    const base = await start()

    const unavailable = await fetch(`${base}${path}?name=demo`)
    expect(await unavailable.json()).toEqual({ status: 'unavailable' })
    const invalid = await fetch(`${base}${path}?name=..%2Fdemo`)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'SKILL_NAME_INVALID' })
    expect((await fetch(`${base}${path}`, { method: 'POST' })).status).toBe(405)
  })

  it('内核技能服务上线和卸载后，状态接口即时反映其可用性', async () => {
    const directory = join(home, 'skills', 'demo')
    mkdirSync(directory, { recursive: true })
    const base = await start()
    expect(await (await fetch(`${base}${path}?name=demo`)).json()).toEqual({ status: 'unavailable' })

    const provider = await host!.plugin({
      name: 'skill-hub-test-late-skills',
      apply(ctx) {
        ctx.provide('skills', {
          get: async () => ({
            source: 'user-dsh',
            resourceBase: { kind: 'directory', path: directory },
            invocation: { userInvocable: true },
          }),
        })
      },
    }).await()
    expect(await (await fetch(`${base}${path}?name=demo`)).json()).toEqual({ status: 'ready' })

    await provider.dispose()
    expect(await (await fetch(`${base}${path}?name=demo`)).json()).toEqual({ status: 'unavailable' })
  })

  it('连接服务未就绪时不注册路由，并随连接服务启停卸载', async () => {
    host = new Context()
    const routes = new Set<string>()
    await host.plugin({
      name: 'skill-hub-test-web-server',
      apply(ctx) {
        ctx.provide('webServer', {
          register(route: WebRoute) {
            routes.add(route.path)
            return () => routes.delete(route.path)
          },
        })
      },
    }).await()
    const plugin = await host.plugin(skillHub).await()
    expect(routes.has(path)).toBe(false)

    const connection = await host.plugin({
      name: 'skill-hub-test-connection',
      apply(ctx) {
        ctx.provide('connection', { requestRejection: () => undefined })
      },
    }).await()
    await plugin.await()
    expect(routes.has(path)).toBe(true)

    await connection.dispose()
    await plugin.await()
    expect(routes.size).toBe(0)
  })

  it.each([401, 403] as const)('状态接口保留连接服务返回的 %s 鉴权拒绝', async (status) => {
    const base = await start(undefined, status)
    const response = await fetch(`${base}${path}?name=demo`)

    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: status === 401 ? 'unauthorized' : 'forbidden' })
  })

  it('内核读取失败时返回明确的错误', async () => {
    const base = await start({
      get: async () => {
        throw new Error('registry failed')
      },
    })

    const response = await fetch(`${base}${path}?name=demo`)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'registry failed' })
  })

  it('已发现的技能目录无法读取时返回明确的文件系统错误', async () => {
    const base = await start({
      get: async () => ({
        source: 'user-dsh',
        resourceBase: { kind: 'directory', path: join(home, 'skills', 'demo') },
        invocation: { userInvocable: true },
      }),
    })

    const response = await fetch(`${base}${path}?name=demo`)
    const result = await response.json() as { error: string }

    expect(response.status).toBe(500)
    expect(result.error).toContain('ENOENT')
  })

  it('等待上限后仍未发现技能时返回待加载状态', async () => {
    await start({ get: async () => undefined })
    vi.useFakeTimers()

    const pending = localSkill.get('demo')
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toEqual({ status: 'pending' })
  })
})
