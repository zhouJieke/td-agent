// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { store } from '../store'
import { SkillCreatorPrefill } from './skill-creator-prefill'

afterEach(() => {
  cleanup()
  store.prefill.clear()
  vi.restoreAllMocks()
})

describe('技能中心创建器草稿', () => {
  it('已登记的会话挂载时填入创建器命令并消费登记', async () => {
    const setDraft = vi.fn()
    store.prefill.add('session-a')

    render(<SkillCreatorPrefill sessionId="session-a" inputActions={{ setDraft }} />)

    await vi.waitFor(() => expect(setDraft).toHaveBeenCalledExactlyOnceWith('/skill-creator '))
    expect(store.prefill.pendingSessionIds).toEqual([])
  })

  it('复用已挂载会话时仍处理晚到的创建请求', async () => {
    const setDraft = vi.fn()
    render(<SkillCreatorPrefill sessionId="session-a" inputActions={{ setDraft }} />)
    expect(setDraft).not.toHaveBeenCalled()

    await act(async () => store.prefill.add('session-a'))

    await vi.waitFor(() => expect(setDraft).toHaveBeenCalledExactlyOnceWith('/skill-creator '))
    expect(store.prefill.pendingSessionIds).toEqual([])
  })

  it('其他会话不会消费目标会话的创建请求', async () => {
    const setDraft = vi.fn()
    render(<SkillCreatorPrefill sessionId="session-a" inputActions={{ setDraft }} />)

    await act(async () => store.prefill.add('session-b'))

    expect(setDraft).not.toHaveBeenCalled()
    expect(store.prefill.pendingSessionIds).toEqual(['session-b'])
  })
})
