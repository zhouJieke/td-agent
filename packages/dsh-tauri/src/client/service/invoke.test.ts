import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from './invoke'

const bridge = vi.hoisted(() => ({
  listener: undefined as undefined | ((reply: { type: string, nonce: string, ok: boolean, value?: unknown }) => void),
  send: vi.fn((_request: { nonce: string }) => ({ ok: true })),
  unlisten: vi.fn(),
}))

vi.mock('./invoke-parent', () => ({ invokeParent: bridge.send }))
vi.mock('./listen-parent', () => ({
  listenParent: (listener: typeof bridge.listener) => {
    bridge.listener = listener
    return bridge.unlisten
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  bridge.listener = undefined
  bridge.send.mockClear()
  bridge.unlisten.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('iframe invoke timeout', () => {
  it('默认调用在 15 秒后超时', async () => {
    const pending = invoke('test-command')
    const result = expect(pending).rejects.toThrow('NODE_NOT_ANSWERED: invoke test-command timed out')

    await vi.advanceTimersByTimeAsync(15_000)

    await result
    expect(bridge.unlisten).toHaveBeenCalledTimes(1)
  })

  it('自定义超时允许耗时操作在默认时限后完成', async () => {
    const pending = invoke<string>('install', { name: 'demo' }, { timeoutMs: 90_000 })
    const settled = vi.fn()
    void pending.then(settled, settled)
    await vi.advanceTimersByTimeAsync(15_001)
    expect(settled).not.toHaveBeenCalled()

    const request = bridge.send.mock.calls[0][0]
    bridge.listener?.({ type: 'dsh://tauri:reply', nonce: request.nonce, ok: true, value: 'ready' })

    await expect(pending).resolves.toBe('ready')
    expect(bridge.unlisten).toHaveBeenCalledTimes(1)
  })
})
