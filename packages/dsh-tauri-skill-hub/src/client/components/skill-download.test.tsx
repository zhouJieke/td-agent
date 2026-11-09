// @vitest-environment jsdom
import type { SkillSummary, UserSkillDetails } from '../types'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../locales'
import { downloadSkill, fetchInstalledSkills, updateSkill } from '../service/skill'
import { store } from '../store'
import { MineView } from './mine-view'
import { SkillCatalog } from './skill-catalog'
import { SkillHubPanel } from './skill-hub-panel'

vi.mock('../service/skill', () => ({
  downloadSkill: vi.fn(),
  fetchInstalledSkills: vi.fn(),
  loadSkillHub: vi.fn(),
  updateSkill: vi.fn(),
  uploadMySkill: vi.fn(),
}))

function summary(name: string, latest?: string): SkillSummary {
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
    labels: latest === undefined ? {} : { latest },
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
  vi.mocked(updateSkill).mockReset()
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

  it('企业和个人列表中有新版本的已安装技能提供更新入口', () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['shared'], { shared: '1.0.0' }, ['shared'])
    const mine: UserSkillDetails = {
      userId: 'E1',
      skillNames: ['shared'],
      skills: [{ summary: summary('shared', '1.1.0'), versions: [] }],
      failed: [],
    }
    const enterprise = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('shared', '1.1.0')]} />)
    const personal = render(<MineView t={locale.text} mine={mine} hint="" emptyText="" />)

    expect(within(enterprise.container).getByRole('button', { name: 'Downloaded skill shared' }).hasAttribute('disabled')).toBe(true)
    expect(within(personal.container).getByRole('button', { name: 'Downloaded skill shared' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(enterprise.container).getByRole('button', { name: 'Update skill shared' }))
    expect(updateSkill).toHaveBeenCalledExactlyOnceWith({ name: 'shared', latestVersion: '1.1.0', installedVersion: '1.0.0' })
    expect(within(personal.container).getByRole('button', { name: 'Update skill shared' }).hasAttribute('disabled')).toBe(false)
  })

  it.each([
    { installed: '1.2.0', latest: '1.2.0', update: false },
    { installed: '1.10.0', latest: '1.2.0', update: false },
    { installed: '1.2.0', latest: '1.10.0', update: true },
    { installed: '2.0.0-rc.1', latest: '2.0.0', update: true },
    { installed: '2.0.0', latest: '2.0.0-rc.1', update: false },
  ])('比较已安装版本 $installed 和远端版本 $latest', ({ installed, latest, update }) => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: installed }, ['demo'])
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('demo', latest)]} />)

    expect(view.queryByRole('button', { name: 'Update skill demo' }) !== null).toBe(update)
  })

  it('旧技能版本未知时先要求确认覆盖，再更新并建立版本记录', () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['legacy'], {}, ['legacy'])
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('legacy', '2.0.0')]} />)

    expect(view.getByText('Installed version unknown').textContent).toBe('Installed version unknown')
    fireEvent.click(view.getByRole('button', { name: 'Update skill legacy' }))
    expect(updateSkill).not.toHaveBeenCalled()
    const dialog = view.getByRole('dialog', { name: 'Update skill with unknown version?' })
    expect(within(dialog).getByText('Updating replaces the local skill and all its files. Back up any local changes first.').textContent)
      .toBe('Updating replaces the local skill and all its files. Back up any local changes first.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update skill' }))

    expect(updateSkill).toHaveBeenCalledExactlyOnceWith({ name: 'legacy', latestVersion: '2.0.0', installedVersion: null })
  })

  it('取消未知版本覆盖时不发起更新', () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['legacy'], {}, ['legacy'])
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('legacy', '2.0.0')]} />)

    fireEvent.click(view.getByRole('button', { name: 'Update skill legacy' }))
    const dialog = view.getByRole('dialog', { name: 'Update skill with unknown version?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(view.queryByRole('dialog', { name: 'Update skill with unknown version?' })).toBeNull()
    expect(updateSkill).not.toHaveBeenCalled()
  })

  it('本地目录不能安全覆盖时不显示更新入口', () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['legacy'], {}, [])
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('legacy', '2.0.0')]} />)

    expect(view.getByText('Installed version unknown').textContent).toBe('Installed version unknown')
    expect(view.getByText('Cannot safely replace').textContent).toBe('Cannot safely replace')
    expect(view.queryByRole('button', { name: 'Update skill legacy' })).toBeNull()
  })

  it.each([undefined, 'not-a-version'])('远端版本 %s 不可用时明确提示且不提供更新', (latest) => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    const view = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('demo', latest)]} />)

    expect(view.getByText('Remote version unavailable').textContent).toBe('Remote version unavailable')
    expect(view.queryByRole('button', { name: 'Update skill demo' })).toBeNull()
  })

  it('更新进行中时两个列表都禁用同名技能的更新入口', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['shared'], { shared: '1.0.0' }, ['shared'])
    const mine: UserSkillDetails = {
      userId: 'E1',
      skillNames: ['shared'],
      skills: [{ summary: summary('shared', '1.1.0'), versions: [] }],
      failed: [],
    }
    const enterprise = render(<SkillCatalog t={locale.text} hint="" emptyText="" skills={[summary('shared', '1.1.0')]} />)
    const personal = render(<MineView t={locale.text} mine={mine} hint="" emptyText="" />)

    act(() => store.skill.startDownload('shared'))

    await waitFor(() => {
      expect(within(enterprise.container).getByRole('button', { name: 'Updating skill shared' }).hasAttribute('disabled')).toBe(true)
      expect(within(personal.container).getByRole('button', { name: 'Updating skill shared' }).hasAttribute('disabled')).toBe(true)
    })
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

  it.each([
    { status: 'ready', message: 'Updated demo. Enter /demo in a conversation to use it.' },
    { status: 'pending', message: 'Updated demo, but the kernel has not confirmed it yet. Refresh the local skills list or restart.' },
    { status: 'shadowed', message: 'Updated demo, but another skill with the same name takes precedence. Remove the conflicting skill first.' },
    { status: 'not-invocable', message: 'Updated demo, but the kernel does not allow invoking it as a command.' },
    { status: 'unavailable', message: 'Updated demo, but the kernel status could not be verified. Check the kernel, then try again.' },
  ] as const)('更新后内核状态为 $status 时展示对应提示', ({ status, message }) => {
    store.skill.notifyUpdated('demo', status)

    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent).toBe(message)
  })

  it('下载包版本与远端不一致时提示没有覆盖本地文件', () => {
    store.skill.notifyFailed('SKILL_VERSION_MISMATCH: downloaded version differs from the catalog')

    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent)
      .toBe('The downloaded package does not match the latest remote version. No local files were replaced; refresh and try again.')
  })

  it('版本不一致时展示期望版本和实际下载版本', () => {
    store.skill.notifyFailed('SKILL_VERSION_MISMATCH: expected=0.0.2, received=0.0.1')

    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent)
      .toBe('Expected version 0.0.2, but the download returned 0.0.1. No local files were replaced; try again later.')
  })

  it('远端最新版本发生变化时提示刷新且不误报覆盖成功', () => {
    store.skill.notifyFailed('SKILL_REMOTE_VERSION_CHANGED: latest version changed')

    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent)
      .toBe('The latest remote version changed. No local files were replaced; refresh the list and try again.')
  })

  it('原生命令返回异常结果时不误报本地文件未覆盖', () => {
    store.skill.notifyFailed('SKILL_UPDATE_RESULT_INVALID')

    const view = render(<SkillHubPanel t={locale.text} createSkill={async () => {}} />)

    expect(view.getByRole('alert').textContent)
      .toBe('The update result could not be confirmed. Refresh local skills and check the result.')
  })
})
