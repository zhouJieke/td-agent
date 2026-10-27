import { describe, expect, it } from 'vitest'
import { navBridgeOf } from './nav-bridge'

describe('navBridgeOf', () => {
  it('sends no callbacks while the iframe is absent', () => {
    const post = () => {}
    expect(navBridgeOf(post, false)).toEqual({})
  })

  it('translates every navbar action into its protocol message', () => {
    const sent: Array<Record<string, unknown>> = []
    const bridge = navBridgeOf(message => sent.push(message), true)

    bridge.onToggleSidebar?.()
    bridge.onNewChat?.()
    bridge.onOpenFolder?.()

    expect(sent).toEqual([
      { type: 'dsh://sidebar:toggle' },
      { type: 'dsh://session:new' },
      { type: 'dsh://workspace:add' },
    ])
  })
})
