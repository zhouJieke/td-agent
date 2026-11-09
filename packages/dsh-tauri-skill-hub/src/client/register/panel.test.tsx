// @vitest-environment jsdom
import type { ClientContext } from 'dsh-tauri/client'
import { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { definePanel } from 'dsh-tauri/client'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillHubPanel } from '../components/skill-hub-panel'
import { store } from '../store'
import { panelFeature } from './panel'

vi.mock('dsh-tauri/client', async importOriginal => ({
  ...await importOriginal<typeof import('dsh-tauri/client')>(),
  definePanel: vi.fn(),
}))
vi.mock('../components/skill-hub-panel', () => ({ SkillHubPanel: vi.fn(() => null) }))
vi.mock('../service/skill', () => ({ loadSkillHub: vi.fn() }))

const close = vi.fn()
const disposers: Array<() => void> = []

function renderRegisteredPanel() {
  const entry = vi.mocked(definePanel).mock.calls.at(-1)?.[1]
  if (entry === undefined)
    throw new Error('Skill hub panel was not registered')
  render(createElement(entry.render))
  const createSkill = vi.mocked(SkillHubPanel).mock.calls.at(-1)?.[0].createSkill
  if (createSkill === undefined)
    throw new Error('Skill creator action was not passed to the panel')
  return createSkill
}

function install(options: { workspaces?: unknown, create?: () => unknown, open?: () => unknown } = {}) {
  const createSession = vi.fn(options.create ?? (() => 'created-session'))
  const connectWorkspace = vi.fn(() => 'reused-session')
  const openSession = vi.fn(options.open ?? (() => undefined))
  const services = {
    sessions: {
      list: { getSnapshot: () => ({ ids: ['current-session'] }) },
      create: createSession,
    },
    workspaces: {
      list: {
        getSnapshot: () => options.workspaces ?? {
          items: [
            { workspaceId: 'recent-workspace', sessionIds: [] },
            { workspaceId: 'current-workspace', sessionIds: ['current-session'] },
          ],
          recentWorkspaceId: 'recent-workspace',
        },
      },
    },
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'current-session' }) } } },
    uiWorkspace: { connectWorkspace, openSession },
  }
  const context = { get: (name: keyof typeof services) => services[name] } as unknown as ClientContext
  const dispose = panelFeature.call(context)
  disposers.push(dispose)
  const createSkill = renderRegisteredPanel()
  return { connectWorkspace, createSession, openSession, createSkill, dispose }
}

beforeEach(() => {
  store.prefill.clear()
  close.mockReset()
  vi.mocked(definePanel).mockReset()
  vi.mocked(definePanel).mockReturnValue({ close, select: vi.fn(), dispose: vi.fn() })
  vi.mocked(SkillHubPanel).mockClear()
})

afterEach(() => {
  for (const dispose of disposers.splice(0))
    dispose()
  cleanup()
  store.prefill.clear()
  vi.restoreAllMocks()
})

describe('技能中心创建会话', () => {
  it('会话和工作区服务晚于面板激活时仍能创建并打开新会话', async () => {
    const root = new Context()
    const createSession = vi.fn(async () => 'created-session')
    const openSession = vi.fn()
    try {
      await root.plugin({
        name: 'skill-hub-foundation-test',
        apply(ctx) {
          ctx.provide('slots', {})
          ctx.provide('layout', {})
          ctx.provide('locale', {})
        },
      }).await()
      await root.plugin({
        name: 'skill-hub-panel-test',
        inject: ['slots', 'layout', 'locale'],
        apply(ctx) {
          ctx.effect(panelFeature)
        },
      }).await()
      const createSkill = renderRegisteredPanel()

      await root.plugin({
        name: 'skill-hub-late-services-test',
        apply(ctx) {
          ctx.provide('sessions', {
            list: { getSnapshot: () => ({ ids: ['current-session'] }), subscribe: () => () => {} },
            create: createSession,
          })
          ctx.provide('workspaces', {
            list: {
              getSnapshot: () => ({ items: [{ workspaceId: 'current-workspace', sessionIds: ['current-session'] }] }),
              subscribe: () => () => {},
            },
          })
          ctx.provide('uiWorkspace', { openSession })
          ctx.provide('uiSession', { adapter: { current: { getSnapshot: () => ({ key: 'current-session' }) } } })
        },
      }).await()

      await createSkill()

      expect(createSession).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current-workspace' })
      expect(openSession).toHaveBeenCalledExactlyOnceWith('created-session')
      expect(store.prefill.pendingSessionIds).toEqual(['created-session'])
      expect(close).toHaveBeenCalledOnce()
    }
    finally {
      await root.fiber.dispose()
    }
  })

  it('优先选择当前工作区并创建新会话，避免覆盖已有会话草稿', async () => {
    const { connectWorkspace, createSession, openSession, createSkill } = install()

    await createSkill()

    expect(createSession).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'current-workspace' })
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(openSession).toHaveBeenCalledExactlyOnceWith('created-session')
    expect(store.prefill.pendingSessionIds).toEqual(['created-session'])
    expect(close).toHaveBeenCalledOnce()
  })

  it('必需能力确实缺失时报告错误并记录具体缺失项', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const dispose = panelFeature.call({ get: () => undefined })
    disposers.push(dispose)
    const createSkill = renderRegisteredPanel()

    await expect(createSkill()).rejects.toThrow('This kernel cannot open a skill creation session.')

    expect(log).toHaveBeenCalledExactlyOnceWith(
      '[skill-hub] Skill creator unavailable: workspaces.list, sessions.create, navigation.openSession',
    )
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('没有可用工作区时报告错误且不留下草稿登记', async () => {
    const { createSession, openSession, createSkill } = install({ workspaces: { items: [] } })

    await expect(createSkill()).rejects.toThrow('No workspace is available')
    expect(createSession).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('创建会话失败时保留错误且不登记草稿', async () => {
    const { createSkill, openSession } = install({
      create: async () => {
        throw new Error('create failed')
      },
    })

    await expect(createSkill()).rejects.toThrow('create failed')
    expect(openSession).not.toHaveBeenCalled()
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('打开会话失败时撤销草稿登记', async () => {
    const { createSkill } = install({
      open: () => {
        throw new Error('open failed')
      },
    })

    await expect(createSkill()).rejects.toThrow('open failed')
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('异步打开会话失败时撤销草稿登记', async () => {
    const { createSkill } = install({
      open: async () => {
        throw new Error('open failed')
      },
    })

    await expect(createSkill()).rejects.toThrow('open failed')
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('插件卸载后不再打开等待连接的会话', async () => {
    let finish!: (sessionId: string) => void
    const pending = new Promise<string>((resolve) => {
      finish = resolve
    })
    const { createSkill, dispose, openSession } = install({ create: () => pending })
    const creation = createSkill()

    dispose()
    finish('created-session')

    await expect(creation).rejects.toThrow('Skill creation was interrupted. Try again.')
    expect(openSession).not.toHaveBeenCalled()
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('等待打开会话时插件卸载会撤销草稿登记', async () => {
    let finish!: () => void
    let reportStarted!: () => void
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve
    })
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const { createSkill, dispose } = install({
      open: () => {
        reportStarted()
        return pending
      },
    })
    const creation = createSkill()
    await started
    expect(store.prefill.pendingSessionIds).toEqual(['created-session'])

    dispose()
    finish()

    await expect(creation).rejects.toThrow('Skill creation was interrupted. Try again.')
    expect(store.prefill.pendingSessionIds).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })
})
