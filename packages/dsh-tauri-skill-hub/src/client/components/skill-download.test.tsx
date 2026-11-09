// @vitest-environment jsdom
import type { SkillSummary, UserSkillDetails } from '../types'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../locales'
import { downloadSkill, fetchInstalledSkills } from '../service/skill'
import { store } from '../store'
import { MineView } from './mine-view'
import { SkillCatalog } from './skill-catalog'
import { SkillHubPanel } from './skill-hub-panel'

vi.mock('../service/skill', () => ({
  downloadSkill: vi.fn(),
  fetchInstalledSkills: vi.fn(),
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
  store.skill.setTab('enterprise')
  store.skill.setEmployee({ employeeNumber: 'E1', employeeName: 'Employee' })
  store.skill.setCommon([])
  store.skill.setMine(null)
  store.skill.setError('')
  store.skill.setKeyword('')
  store.skill.dismissFeedback()
  store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), [])
  for (const name of store.skill.downloading)
    store.skill.finishDownload(name)
  vi.mocked(downloadSkill).mockReset()
  vi.mocked(fetchInstalledSkills).mockReset()
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

    await waitFor(() => expect(view.getByRole('button', { name: 'Downloading skill alpha' }).hasAttribute('disabled')).toBe(true))
    expect(view.getByRole('button', { name: 'Download skill beta' }).hasAttribute('disabled')).toBe(false)
  })

  it('企业和个人列表中的同名已安装技能显示已下载且不能点击', () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['shared', 'unavailable'])
    const mine: UserSkillDetails = {
      userId: 'E1',
      skillNames: ['shared', 'unavailable'],
      skills: [{ summary: summary('shared'), versions: [] }],
      failed: [{ name: 'unavailable', reason: '详情暂不可用' }],
    }
    const enterprise = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('shared'), summary('new')]} />)
    const personal = render(<MineView t={locale.text} mine={mine} hint="" emptyText="" />)
    const commonButton = within(enterprise.container).getByRole('button', { name: 'Downloaded skill shared' })
    const personalButton = within(personal.container).getByRole('button', { name: 'Downloaded skill shared' })
    const failedButton = within(personal.container).getByRole('button', { name: 'Downloaded skill unavailable' })

    expect(commonButton.textContent).toBe('Downloaded')
    expect(commonButton.hasAttribute('disabled')).toBe(true)
    expect(personalButton.hasAttribute('disabled')).toBe(true)
    expect(failedButton.hasAttribute('disabled')).toBe(true)
    fireEvent.click(commonButton)
    fireEvent.click(personalButton)
    fireEvent.click(failedButton)
    expect(downloadSkill).not.toHaveBeenCalled()
    expect(within(enterprise.container).getByRole('button', { name: 'Download skill new' }).hasAttribute('disabled')).toBe(false)
  })

  it('完成安装后无需等待内核确认即可更新按钮', async () => {
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('alpha')]} />)

    act(() => store.skill.markInstalled('alpha'))

    const button = await view.findByRole('button', { name: 'Downloaded skill alpha' })
    expect(button.textContent).toBe('Downloaded')
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('检查安装状态期间禁用下载，检查完成后恢复未安装项', async () => {
    const requestId = store.skill.startInstalledLoad()
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('alpha')]} />)

    expect(view.getByRole('button', { name: 'Checking installation of skill alpha' }).hasAttribute('disabled')).toBe(true)
    act(() => store.skill.finishInstalledLoad(requestId, []))
    expect((await view.findByRole('button', { name: 'Download skill alpha' })).hasAttribute('disabled')).toBe(false)
  })

  it('本地状态查询失败时显示错误并提供重试', () => {
    store.skill.setCommon([summary('alpha')])
    store.skill.failInstalledLoad(store.skill.startInstalledLoad(), 'permission denied')
    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent).toBe('Could not read local skill installation status: permission denied')
    expect(view.getByRole('button', { name: 'Installation status unavailable for skill alpha' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(view.getByRole('button', { name: 'Retry' }))
    expect(fetchInstalledSkills).toHaveBeenCalledOnce()
  })
})

describe('技能下载反馈', () => {
  it.each([
    { status: 'ready', message: 'Installed demo. Enter /demo in a conversation to use it.' },
    { status: 'pending', message: 'Installed demo, but the kernel has not confirmed it yet. Refresh the local skills list or restart.' },
    { status: 'shadowed', message: 'Installed demo, but another skill with the same name takes precedence. Remove the conflicting skill first.' },
    { status: 'not-invocable', message: 'Installed demo, but the kernel does not allow invoking it as a command.' },
    { status: 'unavailable', message: 'Installed demo, but the kernel status could not be verified. Check the kernel, then try again.' },
  ] as const)('内核状态为 $status 时展示对应提示', ({ status, message }) => {
    store.skill.notifyDownloaded('demo', status)

    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent).toBe(message)
  })
})
