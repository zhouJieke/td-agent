import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { $fetch } from 'ofetch'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import * as skillHub from '../../index'
import { provider } from '../service/provider'

const fixture = vi.hoisted(() => ({ home: '' }))

vi.mock('dsh-tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dsh-tauri')>()
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  fixture.home = mkdtempSync(join(tmpdir(), 'dsh-local-skills-'))
  return { ...actual, DSH_HOME: fixture.home, openDirectory: vi.fn().mockResolvedValue(undefined) }
})

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('@deepseek-ai/dsh-skill-filesystem'))
const { default: SkillRegistry, isUserInvocable } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-skill')).href)
const prefix = '/api/tauri/skill-hub'

let host: Context | undefined
let listener: Server | undefined

function writeSkill(root: string, name: string, description = `${name} description`): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'SKILL.md')
  writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n${name} instructions\n`)
  return file
}

function tarball(entries: Array<{ name: string, content: string, type?: string, corruptChecksum?: boolean, invalidSize?: boolean }>): Buffer {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.content)
    const header = Buffer.alloc(512)
    header.write(entry.name, 0, 100)
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    header.write(entry.invalidSize ? '0000000000x\0' : `${body.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write('00000000000\0', 136)
    header.fill(32, 148, 156)
    header.write(entry.type ?? '0', 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148)
    if (entry.corruptChecksum)
      header[0] ^= 1
    blocks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
}

function interceptGitHub(archive: Buffer) {
  const response = Object.assign(new Response(null, { status: 200 }), {
    _data: Uint8Array.from(archive).buffer,
  })
  return vi.spyOn($fetch, 'raw').mockResolvedValue(response)
}

async function start(withSkills = true, loadFilesystem: () => Promise<typeof filesystem> = async () => filesystem) {
  const routes = new Map<string, WebRoute>()
  host = new Context()
  const registry = withSkills ? new SkillRegistry(host) : undefined
  await host.plugin({
    name: 'local-skills-test-services',
    apply(ctx) {
      ctx.provide('webServer', {
        register(route: WebRoute) {
          const key = `${route.kind}\u0000${route.path}`
          if (routes.has(key))
            throw new Error(`duplicate route: ${key}`)
          routes.set(key, route)
          return () => routes.delete(key)
        },
      })
      ctx.provide('connection', { requestRejection: () => undefined })
      ctx.provide('loader', {
        import: loadFilesystem,
        unwrapExports: (value: unknown) => value,
      })
    },
  }).await()
  const existing = withSkills
    ? await host.plugin(filesystem, {
        providerName: 'filesystem',
        dshHome: fixture.home,
        agentsHome: join(fixture.home, 'agents'),
        bundledSkillDir: join(fixture.home, 'bundled'),
        watch: false,
      }).await()
    : undefined
  await host.plugin(skillHub).await()
  listener = createServer((request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.get(`exact\u0000${pathname}`)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    Promise.resolve(route.handler(request, response)).catch((error: unknown) => {
      if (!response.headersSent)
        response.writeHead(500)
      response.end(error instanceof Error ? error.message : String(error))
    })
  })
  await new Promise<void>(done => listener!.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
  return { base, registry, existing }
}

async function json(base: string, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}${prefix}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  vi.stubEnv('HOME', fixture.home)
  vi.stubEnv('USERPROFILE', fixture.home)
  vi.stubEnv('DSH_HOME', fixture.home)
  vi.stubEnv('DSH_AGENTS_HOME', join(fixture.home, 'agents'))
  vi.stubEnv('DSH_BUNDLED_SKILL_DIR', join(fixture.home, 'bundled'))
  rmSync(join(fixture.home, 'skills'), { recursive: true, force: true })
  rmSync(join(fixture.home, 'bundled'), { recursive: true, force: true })
  rmSync(join(fixture.home, 'repository'), { recursive: true, force: true })
})

afterEach(async () => {
  if (listener !== undefined) {
    await new Promise<void>((done, reject) => listener!.close(error => error ? reject(error) : done()))
    listener = undefined
  }
  if (host !== undefined) {
    await host.fiber.dispose()
    host = undefined
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

afterAll(() => {
  if (dirname(fixture.home) !== resolve(tmpdir()) || !basename(fixture.home).startsWith('dsh-local-skills-'))
    throw new Error(`Unexpected test directory: ${fixture.home}`)
  rmSync(fixture.home, { recursive: true, force: true })
})

describe('技能中心独立本地技能后台', () => {
  it('区分已安装版本、旧技能和不能安全覆盖的同名文件', async () => {
    const root = join(fixture.home, 'skills')
    writeSkill(root, 'versioned')
    writeFileSync(join(root, 'versioned', '.dsh-tauri-skill-version.json'), JSON.stringify({ source: 'nacos', version: '1.2.0' }))
    writeSkill(root, 'constructor')
    writeFileSync(join(root, 'constructor', '.dsh-tauri-skill-version.json'), JSON.stringify({ source: 'nacos', version: '1.0.0' }))
    writeSkill(root, 'legacy')
    writeSkill(root, 'ambiguous')
    writeFileSync(join(root, 'ambiguous.md'), '---\nname: ambiguous\n---\n')
    writeFileSync(join(root, 'flat.md'), '---\nname: flat\n---\n')
    const { base } = await start(false)

    expect(await json(base, '/installed-skills')).toEqual({
      status: 200,
      body: {
        names: ['ambiguous', 'constructor', 'flat', 'legacy', 'versioned'],
        versions: { constructor: '1.0.0', versioned: '1.2.0' },
        updatableNames: ['constructor', 'legacy', 'versioned'],
      },
    })
  })

  it('已安装版本记录损坏时明确返回错误', async () => {
    const root = join(fixture.home, 'skills')
    writeSkill(root, 'demo')
    writeFileSync(join(root, 'demo', '.dsh-tauri-skill-version.json'), '{invalid')
    const { base } = await start(false)

    const result = await json(base, '/installed-skills')

    expect(result.status).toBe(500)
    expect(result.body.error).toContain('SKILL_VERSION_METADATA_INVALID')
  })

  it('链接的技能目录不可覆盖且不会读取链接目标的版本记录', async () => {
    const root = join(fixture.home, 'skills')
    const external = join(fixture.home, 'repository')
    writeSkill(external, 'linked')
    writeFileSync(join(external, 'linked', '.dsh-tauri-skill-version.json'), '{invalid')
    mkdirSync(root, { recursive: true })
    symlinkSync(join(external, 'linked'), join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const { base } = await start(false)

    expect(await json(base, '/installed-skills')).toEqual({
      status: 200,
      body: { names: ['linked'], versions: {}, updatableNames: [] },
    })
  })

  it('内核服务不可用时仍从本地技能文件批量识别已安装名称', async () => {
    const root = join(fixture.home, 'skills')
    writeSkill(root, 'downloaded-skill')
    writeFileSync(join(root, 'downloaded-skill.md'), '---\nname: downloaded-skill\n---\n')
    writeFileSync(join(root, 'single-skill.md'), '---\nname: single-skill\n---\n')
    mkdirSync(join(root, 'unfinished-skill'))
    mkdirSync(join(root, 'not-a-file', 'SKILL.md'), { recursive: true })
    writeSkill(root, 'invalid_name')
    writeFileSync(join(root, 'unrelated.txt'), 'not a skill')
    const { base } = await start(false)

    const result = await json(base, '/installed-skills')

    expect(result).toEqual({ status: 200, body: { names: ['downloaded-skill', 'single-skill'], versions: {}, updatableNames: [] } })
  })

  it('技能目录尚不存在时返回空的已安装列表', async () => {
    const { base } = await start(false)

    expect(await json(base, '/installed-skills')).toEqual({ status: 200, body: { names: [], versions: {}, updatableNames: [] } })
  })

  it('技能文件新增和删除后重新查询返回最新状态', async () => {
    const root = join(fixture.home, 'skills')
    const { base } = await start(false)
    writeSkill(root, 'demo')

    expect(await json(base, '/installed-skills')).toEqual({ status: 200, body: { names: ['demo'], versions: {}, updatableNames: ['demo'] } })
    rmSync(join(root, 'demo'), { recursive: true })
    expect(await json(base, '/installed-skills')).toEqual({ status: 200, body: { names: [], versions: {}, updatableNames: [] } })
  })

  it('按当前文件系统的大小写规则识别本地技能', async () => {
    const root = join(fixture.home, 'skills')
    writeSkill(root, 'Mixed-Skill')
    writeFileSync(join(root, 'Mixed-File.MD'), '---\nname: mixed-file\n---\n')
    const { base } = await start(false)
    const expected = [
      ...(existsSync(join(root, 'mixed-file.md')) ? ['mixed-file'] : []),
      ...(existsSync(join(root, 'mixed-skill', 'SKILL.md')) ? ['mixed-skill'] : []),
    ]

    const result = await json(base, '/installed-skills')

    expect(result).toEqual({ status: 200, body: { names: expected, versions: {}, updatableNames: expected.filter(name => name === 'mixed-skill') } })
  })

  it('技能目录无法读取时返回错误而不是伪装成未安装', async () => {
    writeFileSync(join(fixture.home, 'skills'), 'not a directory')
    const { base } = await start(false)

    const result = await json(base, '/installed-skills')

    expect(result.status).toBe(500)
    expect(result.body.error).toContain('ENOTDIR')
  })

  it('与已有内核提供者共存，并在其卸载后仍能发现已下载技能和创建器', async () => {
    writeSkill(join(fixture.home, 'skills'), 'downloaded-skill')
    writeSkill(join(fixture.home, 'bundled'), 'builtin-skill')
    const { base, registry, existing } = await start()

    const initial = await json(base, '/skills')
    expect(initial.status).toBe(200)
    expect(initial.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'builtin-skill', source: 'bundled' }),
      expect.objectContaining({ name: 'downloaded-skill', source: 'user-dsh', editable: true }),
      expect.objectContaining({ name: 'skill-creator' }),
    ]))

    await existing!.dispose()
    const independent = await json(base, '/skills')
    expect(independent.status).toBe(200)
    expect(independent.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'builtin-skill', source: 'bundled' }),
      expect.objectContaining({ name: 'downloaded-skill', source: 'user-dsh', editable: true }),
      expect.objectContaining({ name: 'skill-creator' }),
    ]))
    expect(isUserInvocable(await registry!.get('skill-creator'))).toBe(true)
  })

  it('提供者卸载与重新激活交错时保留新注册的技能', async () => {
    let release!: (plugin: typeof filesystem) => void
    const pending = new Promise<typeof filesystem>((resolve) => {
      release = resolve
    })
    const loadFilesystem = vi.fn()
      .mockResolvedValueOnce(filesystem)
      .mockReturnValueOnce(pending)
      .mockResolvedValue(filesystem)
    const { base, registry } = await start(true, loadFilesystem)
    expect((await json(base, '/skills')).status).toBe(200)

    const stopOld = provider.initialize()
    await vi.waitFor(() => expect(loadFilesystem).toHaveBeenCalledTimes(2))
    const stopping = stopOld()
    const stopNew = provider.initialize()
    release(filesystem)
    await stopping
    await provider.sync()

    expect(await registry!.get('skill-creator')).toMatchObject({ name: 'skill-creator' })
    await stopNew()
  })

  it('本地技能内容、编辑、调用策略与删除使用独立接口', async () => {
    const file = writeSkill(join(fixture.home, 'skills'), 'downloaded-skill')
    const { base } = await start()

    const detail = await json(base, '/skill?name=downloaded-skill')
    expect(detail).toEqual({
      status: 200,
      body: { name: 'downloaded-skill', content: 'downloaded-skill instructions' },
    })
    const save = await json(base, '/skill', 'POST', {
      name: 'downloaded-skill',
      description: 'Updated description',
      modelInvocable: true,
      userInvocable: true,
      content: 'Updated instructions',
    })
    expect(save).toEqual({ status: 200, body: { ok: true, name: 'downloaded-skill' } })
    expect(readFileSync(file, 'utf8')).toContain('Updated instructions')

    const policy = await json(base, '/skill/policy', 'POST', { name: 'downloaded-skill', enabled: false })
    expect(policy).toEqual({ status: 200, body: { ok: true } })
    expect(readFileSync(file, 'utf8')).toContain('user-invocable: false')
    const disabled = await json(base, '/skills')
    expect(disabled.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'downloaded-skill',
        invocation: { modelInvocable: false, userInvocable: false },
      }),
    ]))
    const removed = await json(base, '/skill', 'DELETE', { name: 'downloaded-skill' })
    expect(removed).toEqual({ status: 200, body: { ok: true, name: 'downloaded-skill' } })
    expect(existsSync(file)).toBe(false)
  })

  it('编辑与启停技能时保留其他 YAML 元数据', async () => {
    const file = writeSkill(join(fixture.home, 'skills'), 'metadata-skill')
    writeFileSync(file, [
      '---',
      'name: metadata-skill',
      'description: Original description',
      'license: MIT',
      'metadata:',
      '  author: Example',
      '  capabilities:',
      '    - files',
      '    - network',
      '---',
      'Original instructions',
      '',
    ].join('\n'))
    const { base } = await start()

    const save = await json(base, '/skill', 'POST', {
      name: 'metadata-skill',
      description: 'Updated description',
      modelInvocable: true,
      userInvocable: true,
      content: 'Updated instructions',
    })
    expect(save).toEqual({ status: 200, body: { ok: true, name: 'metadata-skill' } })
    expect(await json(base, '/skill/policy', 'POST', { name: 'metadata-skill', enabled: false }))
      .toEqual({ status: 200, body: { ok: true } })

    const [frontmatter, body] = readFileSync(file, 'utf8').slice(4).split('\n---\n')
    expect(parse(frontmatter)).toEqual({
      'name': 'metadata-skill',
      'description': 'Updated description',
      'license': 'MIT',
      'metadata': { author: 'Example', capabilities: ['files', 'network'] },
      'disable-model-invocation': true,
      'user-invocable': false,
    })
    expect(body.trim()).toBe('Updated instructions')
  })

  it('拒绝编辑或删除内置只读技能', async () => {
    const file = writeSkill(join(fixture.home, 'bundled'), 'builtin-skill')
    const original = readFileSync(file, 'utf8')
    const { base } = await start()

    const edit = await json(base, '/skill', 'POST', {
      name: 'builtin-skill',
      description: 'Changed',
      content: 'Changed',
    })
    const remove = await json(base, '/skill', 'DELETE', { name: 'builtin-skill' })

    expect(edit).toEqual({ status: 403, body: { error: 'skills from source \'bundled\' are read-only' } })
    expect(remove).toEqual({ status: 404, body: { error: 'skill not found' } })
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  it('不会覆盖尚未被内核识别的同名技能文件', async () => {
    const dir = join(fixture.home, 'skills', 'hidden-skill')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'SKILL.md')
    const original = 'not a valid skill yet'
    writeFileSync(file, original)
    const { base } = await start()

    const result = await json(base, '/skill', 'POST', {
      name: 'hidden-skill',
      description: 'Replacement',
      content: 'Do not overwrite',
    })

    expect(result).toEqual({ status: 409, body: { error: 'skill file already exists' } })
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  it('兼容旧版没有仓库列表的状态文件', async () => {
    const dir = join(fixture.home, 'skills')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), '{}')
    writeSkill(dir, 'downloaded-skill')
    const { base } = await start()

    const result = await json(base, '/skills')

    expect(result.status).toBe(200)
    expect(result.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'downloaded-skill', source: 'user-dsh' }),
    ]))
  })

  it('技能文件安装后重新加载本地列表时立即发现新技能', async () => {
    const { base, registry } = await start()
    const before = await json(base, '/skills')
    expect(before.body.skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'newly-installed' }),
    ]))

    writeSkill(join(fixture.home, 'skills'), 'newly-installed')
    const after = await json(base, '/skills/refresh', 'POST')

    expect(after.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'newly-installed', source: 'user-dsh' }),
    ]))
    expect(isUserInvocable(await registry!.get('newly-installed'))).toBe(true)
  })

  it('覆盖已安装技能后刷新提供者，内核读取新技能正文', async () => {
    const root = join(fixture.home, 'skills')
    const file = writeSkill(root, 'updated-skill')
    const { base, registry } = await start()
    expect(await registry!.get('updated-skill')).toMatchObject({
      description: 'updated-skill description',
      content: 'updated-skill instructions',
    })

    rmSync(join(root, 'updated-skill'), { recursive: true })
    writeSkill(root, 'updated-skill', 'Updated description')
    writeFileSync(file, '---\nname: updated-skill\ndescription: Updated description\n---\nNew instructions\n')
    const refreshed = await json(base, '/skills/refresh', 'POST')

    expect(refreshed.status).toBe(200)
    expect(await registry!.get('updated-skill')).toMatchObject({
      description: 'Updated description',
      content: 'New instructions',
    })
  })

  it('导入仓库后自动注册其技能，刷新时发现同一状态文件的新来源', async () => {
    const repository = join(fixture.home, 'repository')
    writeSkill(repository, 'repository-skill')
    const { base } = await start()

    const added = await json(base, '/roots', 'POST', { kind: 'local', path: repository })
    expect(added.status).toBe(200)
    expect(added.body.root).toMatchObject({ kind: 'local', roots: [repository] })
    const list = await json(base, '/skills')
    expect(list.status).toBe(200)
    expect(list.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'repository-skill', source: 'custom', repository: expect.objectContaining({ kind: 'local' }) }),
    ]))

    const secondRoot = join(fixture.home, 'another-repository')
    writeSkill(secondRoot, 'another-skill')
    const statePath = join(fixture.home, 'skills', 'state.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { skillRoots: unknown[] }
    state.skillRoots.push({ id: 'local-another', kind: 'local', label: 'another', roots: [secondRoot], addedAt: 1 })
    writeFileSync(statePath, JSON.stringify(state))
    const refreshed = await json(base, '/skills')
    expect(refreshed.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'another-skill', source: 'custom' }),
    ]))
    rmSync(secondRoot, { recursive: true, force: true })
  })

  it('通过 GitHub 导入仓库并注册技能，移除仓库后清理已导入的文件', async () => {
    const download = interceptGitHub(tarball([
      { name: 'demo-HEAD/skills/github-skill/SKILL.md', content: '---\nname: github-skill\ndescription: From GitHub\n---\nRepository instructions\n' },
      { name: 'demo-HEAD/skills/github-skill/reference.txt', content: 'Repository resource' },
      { name: 'demo-HEAD/skills/github-skill/link', content: '', type: '2' },
    ]))
    const { base } = await start()

    const added = await json(base, '/roots', 'POST', { kind: 'git', url: 'https://github.com/example/demo' })
    expect(download).toHaveBeenCalledExactlyOnceWith(
      'https://codeload.github.com/example/demo/tar.gz/HEAD',
      expect.objectContaining({ responseType: 'arrayBuffer', timeout: 60_000, retry: 0 }),
    )
    expect(added.status).toBe(200)
    expect(added.body.root).toMatchObject({ kind: 'git', label: 'example/demo', live: true })
    const material = added.body.root.materialDir as string
    expect(readFileSync(join(material, 'repo', 'skills', 'github-skill', 'reference.txt'), 'utf8')).toBe('Repository resource')
    expect(lstatSync(join(material, 'repo', 'skills', 'github-skill', 'link'), { throwIfNoEntry: false })).toBeUndefined()
    const listed = await json(base, '/skills')
    expect(listed.body.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'github-skill',
        source: 'custom',
        repository: expect.objectContaining({ label: 'example/demo', kind: 'git' }),
      }),
    ]))

    const removed = await json(base, '/roots', 'DELETE', { id: added.body.root.id })
    expect(removed).toEqual({ status: 200, body: { ok: true } })
    expect(existsSync(material)).toBe(false)
    expect((await json(base, '/skills')).body.skills).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'github-skill' }),
    ]))
  })

  it('导入的 GitHub 仓库包含路径穿越条目时拒绝并清理已解压内容', async () => {
    interceptGitHub(tarball([
      { name: 'demo-HEAD/skills/github-skill/SKILL.md', content: '---\nname: github-skill\ndescription: Valid\n---\nBody\n' },
      { name: 'demo-HEAD/../../outside.txt', content: 'unsafe' },
    ]))
    const { base } = await start()

    const result = await json(base, '/roots', 'POST', { kind: 'git', url: 'example/demo' })

    expect(result).toEqual({ status: 500, body: { error: 'unsafe tar entry name: ../../outside.txt' } })
    expect(readdirSync(join(fixture.home, 'skills', 'repos'))).toEqual([])
    expect(existsSync(join(fixture.home, 'outside.txt'))).toBe(false)
  })

  it.each([
    { defect: 'checksum', corruptChecksum: true, error: 'invalid tar header checksum' },
    { defect: 'size', invalidSize: true, error: 'invalid tar numeric field' },
  ])('导入的 GitHub 仓库的 tar $defect 无效时拒绝部分导入', async ({ corruptChecksum, invalidSize, error }) => {
    interceptGitHub(tarball([
      { name: 'demo-HEAD/skills/github-skill/SKILL.md', content: '---\nname: github-skill\ndescription: Valid\n---\nBody\n' },
      { name: 'demo-HEAD/extra.txt', content: 'data', corruptChecksum, invalidSize },
    ]))
    const { base } = await start()

    const result = await json(base, '/roots', 'POST', { kind: 'git', url: 'example/demo' })

    expect(result).toEqual({ status: 500, body: { error } })
    expect(readdirSync(join(fixture.home, 'skills', 'repos'))).toEqual([])
  })

  it('内核技能服务缺失时返回明确错误，下载状态接口仍可访问', async () => {
    const { base } = await start(false)

    const list = await json(base, '/skills')
    expect(list.status).toBe(500)
    expect(list.body).toEqual({ error: 'DSH skill service is unavailable' })
    expect(await json(base, '/local-skill?name=demo')).toEqual({ status: 200, body: { status: 'unavailable' } })
  })
})
