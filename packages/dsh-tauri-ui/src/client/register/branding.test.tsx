import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from 'dsh-tauri/client'
import type { ComponentType } from 'react'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerBranding } from './branding'

type BrandSlot = 'sidebar.brand.mark' | 'sidebar.brand.name' | 'conversation.hero.brand.mark'

function Root(_props: PropsRenderSlots<BrandSlot>) {
  return null
}

function registry() {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
    },
  }, Root)
  const original = () => null
  core.register({ name: 'sidebar.brand.mark' }, original)
  core.register({ name: 'sidebar.brand.name' }, original)
  const inject = vi.fn((_name: BrandSlot, callback: () => () => void) => callback())
  const ctx = { slots: { register: core.register.bind(core), inject } } as unknown as ClientContext
  return { core, ctx, inject, original }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('desktop branding', () => {
  it('replaces the real single-slot winners and restores them when unloaded', () => {
    vi.stubGlobal('window', { location: { search: '?dshDesktop=1' } })
    const { core, ctx, original } = registry()
    const dispose = registerBranding.call(ctx)

    const name = core.entriesOfSlot('sidebar.brand.name')[0]
    expect(renderToStaticMarkup(createElement(name.component as ComponentType))).toContain('问小达')
    for (const [slot, size] of [['sidebar.brand.mark', 24], ['conversation.hero.brand.mark', 34]] as const) {
      const winner = core.entriesOfSlot(slot)[0]
      expect(winner.component).not.toBe(original)
      const markup = renderToStaticMarkup(createElement(winner.component as ComponentType<{ size: number }>, { size }))
      expect(markup).toContain(`width:${size}px;height:${size}px`)
      expect(markup).toContain('viewBox="0 0 64 64"')
      expect(markup).toContain('fill="#6154e8"')
      expect(markup).not.toContain('<animate')
    }

    dispose()
    expect(core.entriesOfSlot('sidebar.brand.mark')[0].component).toBe(original)
    expect(core.entriesOfSlot('sidebar.brand.name')[0].component).toBe(original)
    expect(core.entriesOfSlot('conversation.hero.brand.mark')).toHaveLength(0)
  })

  it.each([
    { location: { search: '' } },
    { location: { search: '?dshDesktop=1' }, ReactNativeWebView: {} },
  ])('keeps the original branding outside the desktop carrier', (runtime) => {
    vi.stubGlobal('window', runtime)
    const { core, ctx, inject, original } = registry()
    const dispose = registerBranding.call(ctx)

    expect(inject).not.toHaveBeenCalled()
    expect(core.entriesOfSlot('sidebar.brand.mark')[0].component).toBe(original)
    expect(core.entriesOfSlot('sidebar.brand.name')[0].component).toBe(original)
    dispose()
  })
})
