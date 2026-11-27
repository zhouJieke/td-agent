import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from 'dsh-tauri/client'
import type { ComponentType } from 'react'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerMessageFeedback } from './message-feedback'

const SLOT = 'conversation.chat.assistant-actions'
const HEADER_SLOT = 'conversation.session.header.utilities'

function Root(_props: PropsRenderSlots<typeof SLOT | typeof HEADER_SLOT>) {
  return null
}

function Feedback() {
  return (
    <>
      <button>好的回答</button>
      <button>有问题的回答</button>
    </>
  )
}

function SessionMenu() {
  return (
    <>
      <button>更多</button>
      <button>下载 Session 日志</button>
      <button>反馈</button>
    </>
  )
}

function registry() {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: {
      [SLOT]: { kind: 'list', scope: 'session' },
      [HEADER_SLOT]: { kind: 'list', scope: 'session' },
    },
  }, Root)
  core.register({ name: HEADER_SLOT, id: 'session-log-download' }, SessionMenu)
  for (const id of ['open-in-app', 'schedule-catalog']) {
    function HeaderAction() {
      return <button>{id}</button>
    }
    core.register({ name: HEADER_SLOT, id }, HeaderAction)
  }
  core.register({ name: SLOT, id: 'feedback', order: 10 }, Feedback)
  for (const id of ['copy', 'branch', 'usage']) {
    function Action() {
      return <button>{id}</button>
    }
    core.register({ name: SLOT, id }, Action)
  }
  const inject = vi.fn((_name: string, callback: () => (() => void) | undefined) => callback())
  const ctx = { slots: { register: core.register.bind(core), spec: core.spec.bind(core), inject } } as unknown as ClientContext
  return { core, ctx, inject }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('desktop message feedback', () => {
  it('hides only feedback actions and restores them when unloaded', () => {
    vi.stubGlobal('window', { location: { search: '?dshDesktop=1' } })
    const { core, ctx } = registry()
    const dispose = registerMessageFeedback.call(ctx)
    const entries = core.entriesOfSlot(SLOT)
    expect(entries.map(entry => entry.options.id).sort()).toEqual(['branch', 'copy', 'feedback', 'usage'])
    const markup = entries.map(entry => renderToStaticMarkup(createElement(entry.component as ComponentType))).join('')
    expect(markup).toBe('<button>copy</button><button>branch</button><button>usage</button>')
    dispose()
    const feedback = core.entriesOfSlot(SLOT).find(entry => entry.options.id === 'feedback')!
    expect(feedback.component).toBe(Feedback)
  })

  it('hides the session download and feedback menu while preserving other header actions', () => {
    vi.stubGlobal('window', { location: { search: '?dshDesktop=1' } })
    const { core, ctx } = registry()
    const dispose = registerMessageFeedback.call(ctx)
    const entries = core.entriesOfSlot(HEADER_SLOT)
    expect(entries.map(entry => entry.options.id).sort()).toEqual(['open-in-app', 'schedule-catalog', 'session-log-download'])
    const markup = entries.map(entry => renderToStaticMarkup(createElement(entry.component as ComponentType))).join('')
    expect(markup).toBe('<button>open-in-app</button><button>schedule-catalog</button>')
    dispose()
    expect(core.entriesOfSlot(HEADER_SLOT).find(entry => entry.options.id === 'session-log-download')!.component).toBe(SessionMenu)
  })

  it.each([
    { location: { search: '' } },
    { location: { search: '?dshDesktop=1' }, ReactNativeWebView: {} },
  ])('preserves feedback outside the desktop carrier', (runtime) => {
    vi.stubGlobal('window', runtime)
    const { core, ctx, inject } = registry()
    const dispose = registerMessageFeedback.call(ctx)
    expect(inject).not.toHaveBeenCalled()
    expect(core.entriesOfSlot(SLOT).find(entry => entry.options.id === 'feedback')!.component).toBe(Feedback)
    expect(core.entriesOfSlot(HEADER_SLOT).find(entry => entry.options.id === 'session-log-download')!.component).toBe(SessionMenu)
    dispose()
  })
})
