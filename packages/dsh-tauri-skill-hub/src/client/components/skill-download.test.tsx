// @vitest-environment jsdom
import type { SkillSummary, UserSkillDetails } from '../types'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../locales'
import { downloadSkill } from '../service/skill'
import { store } from '../store'
import { MineView } from './mine-view'
import { SkillCatalog } from './skill-catalog'
import { SkillHubPanel } from './skill-hub-panel'

vi.mock('../service/skill', () => ({
  downloadSkill: vi.fn(),
  loadSkillHub: vi.fn(),
  uploadMySkill: vi.fn(),
}))

function summary(name: string): SkillSummary {
  return {
    namespaceId: 'company',
    name,
    description: `${name} description`,
    updateTime: null,
    owner: null,
    enable: true,
    bizTags: null,
    from: null,
    scope: null,
    labels: {},
    editingVersion: null,
    reviewingVersion: null,
    onlineCnt: null,
    downloadCount: null,
  }
}

beforeEach(() => {
  store.skill.setEmployee({ employeeNumber: 'E1', employeeName: 'Employee' })
  store.skill.setTab('enterprise')
  store.skill.setCommon([])
  store.skill.setMine(null)
  store.skill.setError('')
  store.skill.setKeyword('')
  store.skill.dismissFeedback()
  for (const name of store.skill.downloading)
    store.skill.finishDownload(name)
  vi.mocked(downloadSkill).mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('技能列表下载按钮', () => {
  it('企业公用技能的每一项都可按技能名下载', () => {
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('alpha'), summary('beta')]} />)

    fireEvent.click(view.getByRole('button', { name: 'Download skill alpha' }))
    fireEvent.click(view.getByRole('button', { name: 'Download skill beta' }))

    expect(vi.mocked(downloadSkill).mock.calls).toEqual([['alpha'], ['beta']])
  })

  it('我的技能的每一项都可按技能名下载', () => {
    const mine: UserSkillDetails = {
      userId: 'E1',
      skillNames: ['personal', 'temporarily-unavailable'],
      skills: [{ summary: summary('personal'), versions: [] }],
      failed: [{ name: 'temporarily-unavailable', reason: '详情暂不可用' }],
    }
    const view = render(<MineView t={locale.text} mine={mine} hint="" emptyText="" />)

    fireEvent.click(view.getByRole('button', { name: 'Download skill personal' }))
    fireEvent.click(view.getByRole('button', { name: 'Download skill temporarily-unavailable' }))

    expect(vi.mocked(downloadSkill).mock.calls).toEqual([['personal'], ['temporarily-unavailable']])
  })

  it('技能详情全部获取失败时仍提供下载入口，不误显示未配置技能', () => {
    const mine: UserSkillDetails = {
      userId: 'E1',
      skillNames: ['personal'],
      skills: [],
      failed: [{ name: 'personal', reason: '详情暂不可用' }],
    }
    const view = render(<MineView t={locale.text} mine={mine} hint="" emptyText="No configured skills" />)

    fireEvent.click(view.getByRole('button', { name: 'Download skill personal' }))

    expect(downloadSkill).toHaveBeenCalledExactlyOnceWith('personal')
    expect(view.queryByText('No configured skills')).toBeNull()
  })

  it('下载中只禁用对应技能的按钮', async () => {
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('alpha'), summary('beta')]} />)

    act(() => store.skill.startDownload('alpha'))

    await waitFor(() => expect(view.getByRole('button', { name: 'Download skill alpha' }).hasAttribute('disabled')).toBe(true))
    expect(view.getByRole('button', { name: 'Download skill beta' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('技能下载反馈', () => {
  it.each([
    { status: 'ready', message: 'Installed demo. Enter /demo in a conversation to use it.' },
    { status: 'pending', message: 'Installed demo, but the kernel has not confirmed it yet. Check the Extensions skill feature, then refresh the skills list or restart.' },
    { status: 'shadowed', message: 'Installed demo, but another skill with the same name takes precedence. Remove the conflicting skill first.' },
    { status: 'not-invocable', message: 'Installed demo, but the kernel does not allow invoking it as a command.' },
    { status: 'unavailable', message: 'Installed demo, but the kernel status could not be verified. Check the kernel and Extensions, then try again.' },
  ] as const)('内核状态为 $status 时展示对应提示', ({ status, message }) => {
    store.skill.notifyDownloaded('demo', status)

    const view = render(<SkillHubPanel t={locale.text} />)

    expect(view.getByRole('alert').textContent).toBe(message)
  })
})
