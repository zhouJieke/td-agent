import type { HostContext } from '../types'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../../index'

const runtimeRequire = createRequire(import.meta.resolve('@deepseek-ai/dsh-agent-loop'))
const { SystemPrompt, renderPrompt } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-system-prompt')).href)
const { createScope } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-scope')).href)
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0).reverse())
    await context.fiber.dispose()
  vi.unstubAllEnvs()
})

async function scopedPrompt(prefix = 'You are a coding agent powered by the {{model}} model.') {
  const context = new Context()
  contexts.push(context)
  context.provide('connection', { authorizeIndex: () => false } as unknown as HostContext['connection'])
  context.provide('webServer', { register: () => () => {} } as unknown as HostContext['webServer'])
  context.provide('workspaceRegistry', {} as HostContext['workspaceRegistry'])
  const prompt = new SystemPrompt(context, { personaPrefix: '旧的全局身份' })
  prompt.variable('model', () => 'test-model')
  prompt.section({ name: 'test:guidance', order: 1000, text: 'Existing tool guidance' })
  prompt.context({ name: 'test:context', order: 100, text: 'Existing runtime context' })
  prompt.tools(() => ({ schemas: [{ name: 'test_tool', description: 'Existing tool', parameters: { type: 'object', properties: {} } }] }))
  const scope = {}
  await context.plugin({
    apply(owner: Context) {
      const child = createScope(owner, scope)
      owner.effect(() => () => child.dispose())
      child.ctx.systemPrompt.section({ name: 'deployment:persona-prefix', order: 0, text: prefix })
    },
  }).await()
  const plugin = context.plugin({ inject, apply: (owner: Context) => apply(owner as HostContext) })
  await plugin.await()
  return { prompt, scope, plugin }
}

describe('桌面模型身份', () => {
  it('在智能体独立人设覆盖全局前缀后仍输出问小达身份', async () => {
    vi.stubEnv('DSH_TAURI_EMBEDDED', '1')
    const { prompt, scope } = await scopedPrompt()

    const assembly = await prompt.assemble({ scope })

    expect(renderPrompt(assembly)).toBe('你是 问小达，运行在 问小达 Desktop 里的 AI 助手\n\nExisting tool guidance')
    expect(assembly.contexts).toEqual([{ name: 'test:context', text: 'Existing runtime context' }])
    expect(assembly.tools).toEqual([{ name: 'test_tool', description: 'Existing tool', parameters: { type: 'object', properties: {} } }])
  })

  it('保留自定义智能体的职责指令', async () => {
    vi.stubEnv('DSH_TAURI_EMBEDDED', '1')
    const { prompt, scope } = await scopedPrompt('Review security issues in the supplied code.')

    expect(renderPrompt(await prompt.assemble({ scope }))).toBe('你是 问小达，运行在 问小达 Desktop 里的 AI 助手\n\nReview security issues in the supplied code.\n\nExisting tool guidance')
  })

  it('独立 Web 环境保留核心身份', async () => {
    vi.stubEnv('DSH_TAURI_EMBEDDED', '0')
    const { prompt, scope } = await scopedPrompt()

    expect(renderPrompt(await prompt.assemble({ scope }))).toBe('You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent powered by the test-model model.\n\nExisting tool guidance')
  })

  it('卸载桌面插件后移除身份覆盖', async () => {
    vi.stubEnv('DSH_TAURI_EMBEDDED', '1')
    const { prompt, scope, plugin } = await scopedPrompt()
    expect(renderPrompt(await prompt.assemble({ scope }))).toContain('你是 问小达')

    await plugin.dispose()

    expect(renderPrompt(await prompt.assemble({ scope }))).toBe('You are an AI agent powered by DeepSeek Harness.\n\nYou are a coding agent powered by the test-model model.\n\nExisting tool guidance')
  })
})
