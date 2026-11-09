// @vitest-environment jsdom
import type { SkillRowView, SkillSummary, UploadedSkill } from '../types'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { invoke } from 'dsh-tauri/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteSkill, getInstalledSkills, getLocalSkill, getSkill, getSkills, postOpenDir, postRoots, postSkill, postSkillPolicy, postSkillsRefresh } from '../apis'
import { locale } from '../locales'
import { loadSkillHub } from '../service/skill'
import { store } from '../store'
import { LocalSkills } from './local-skills'
import { SkillHubPanel } from './skill-hub-panel'

vi.mock('dsh-tauri/client', async importOriginal => ({
  ...await importOriginal<typeof import('dsh-tauri/client')>(),
  invoke: vi.fn(),
}))

vi.mock('../apis', async importOriginal => ({
  ...await importOriginal<typeof import('../apis')>(),
  deleteSkill: vi.fn(),
  getInstalledSkills: vi.fn(),
  getLocalSkill: vi.fn(),
  getSkill: vi.fn(),
  getSkills: vi.fn(),
  postOpenDir: vi.fn(),
  postRoots: vi.fn(),
  postSkill: vi.fn(),
  postSkillPolicy: vi.fn(),
  postSkillsRefresh: vi.fn(),
}))

vi.mock('../service/skill', async importOriginal => ({
  ...await importOriginal<typeof import('../service/skill')>(),
  loadSkillHub: vi.fn(),
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

function localSkill(name: string, source: 'bundled' | 'user-dsh'): SkillRowView {
  const userSkill = source === 'user-dsh'
  return {
    name,
    description: `${name} description`,
    invocation: { modelInvocable: true, userInvocable: true },
    source,
    provider: 'skill-hub-filesystem',
    editable: userSkill,
    removable: userSkill,
    policyEditable: userSkill,
    ...(userSkill ? { dir: `C:\\isolated\\skills\\${name}` } : {}),
  }
}

function installed(names: string[], versions: Record<string, string> = {}, updatableNames = names) {
  return { names, versions, updatableNames }
}

function uploadInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (input === null)
    throw new Error('Skill upload input is missing')
  return input
}

function uploadFile(): File {
  const bytes = Uint8Array.from([0x50, 0x4B, 0x03, 0x04])
  const file = new File([bytes], 'demo.zip', { type: 'application/zip' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return file
}

function mockUploadBridge(upload: () => Promise<UploadedSkill>): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'desktop_auth_api_base')
      return 'http://127.0.0.1'
    if (command === 'desktop_auth_upload')
      return { code: 0, msg: null, data: await upload() }
    if (command === 'desktop_auth_request' && typeof args === 'object' && args !== null && 'path' in args) {
      if (args.path === '/api/employee-skills/user/E1') {
        return {
          code: 0,
          msg: null,
          data: { userId: 'E1', skillNames: ['demo'], skills: [{ summary: summary('demo'), versions: [] }], failed: [] },
        }
      }
      if (typeof args.path === 'string' && args.path.startsWith('/api/employee-skills?')) {
        return {
          code: 0,
          msg: null,
          data: { totalCount: 1, pageNumber: 1, pagesAvailable: 1, items: [summary('demo')] },
        }
      }
    }
    throw new Error(`Unexpected bridge command: ${command}`)
  })
}

const createSkill = vi.fn(async () => {})

beforeEach(() => {
  store.localSkills.reset()
  store.prefill.clear()
  store.skill.setTab('enterprise')
  store.skill.setEmployee({ employeeNumber: 'E1', employeeName: 'Employee' })
  store.skill.setCommon([])
  store.skill.setCatalog([])
  store.skill.setMine(null)
  store.skill.setManageUser('')
  store.skill.setManageMine(null)
  store.skill.setLoading(false)
  store.skill.setError('')
  store.skill.setKeyword('')
  store.skill.dismissFeedback()
  store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), [])
  for (const name of store.skill.downloading)
    store.skill.finishDownload(name)
  vi.mocked(getSkills).mockReset()
  vi.mocked(getSkill).mockReset()
  vi.mocked(deleteSkill).mockReset()
  vi.mocked(postOpenDir).mockReset()
  vi.mocked(postRoots).mockReset()
  vi.mocked(postSkill).mockReset()
  vi.mocked(postSkillPolicy).mockReset()
  vi.mocked(postSkillsRefresh).mockReset()
  vi.mocked(postSkillsRefresh).mockImplementation(() => getSkills())
  vi.mocked(invoke).mockReset()
  vi.mocked(getLocalSkill).mockReset()
  vi.mocked(getInstalledSkills).mockReset()
  vi.mocked(getInstalledSkills).mockResolvedValue(installed([]))
  vi.mocked(loadSkillHub).mockReset()
  vi.mocked(loadSkillHub).mockImplementation(async () => store.skill.setEmployee(store.skill.employee))
  createSkill.mockReset()
  createSkill.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('技能中心独立本地技能页', () => {
  it('已登录时不在面板标题展示员工姓名和工号', () => {
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    const header = view.container.querySelector('header')
    if (header === null)
      throw new Error('Skill Hub header is missing')

    expect(header.textContent).not.toContain('Employee')
    expect(header.textContent).not.toContain('E1')
  })

  it('本地技能页显示新建入口并隐藏目录和导入入口', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')

    expect(view.queryByRole('button', { name: 'Open skills folder' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Import repository' })).toBeNull()
    expect(view.getByRole('button', { name: 'New skill' }).textContent).toBe('New skill')
  })

  it('隐藏顶部操作时不显示之前打开的仓库导入窗口', async () => {
    store.localSkills.setImportOpen(true)
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    expect(view.queryByRole('dialog', { name: 'Import GitHub skill repository' })).toBeNull()
  })

  it('上传入口仅显示在本地页的新建技能旁', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('tab', { name: 'My skills' }))
    await view.findByText('Skills configured for Employee, with all their versions.')
    expect(view.queryByRole('button', { name: 'Upload skill' })).toBeNull()
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    const upload = view.getByRole('button', { name: 'Upload skill' })
    const create = view.getByRole('button', { name: 'New skill' })
    expect(upload.parentElement).toBe(create.parentElement)
    expect(upload.nextElementSibling).toBe(create)
  })

  it('本地页的上传和新建按钮样式一致', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')
    const upload = view.getByRole('button', { name: 'Upload skill' })
    const create = view.getByRole('button', { name: 'New skill' })

    expect(create.className).not.toBe('')
    expect(upload.className).toBe(create.className)
  })

  it('未登录时隐藏本地页并且不请求本地技能', () => {
    store.skill.setTab('local')
    store.skill.setEmployee(null)
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    expect(view.getByText('Sign in required').textContent).toBe('Sign in required')
    expect(view.queryByText('Not signed in')).toBeNull()
    expect(view.queryByRole('tab', { name: 'Local skills' })).toBeNull()
    expect(view.queryByRole('button', { name: 'New skill' })).toBeNull()
    expect(view.queryByRole('button', { name: 'Upload skill' })).toBeNull()
    expect(getSkills).not.toHaveBeenCalled()
    expect(postSkillsRefresh).not.toHaveBeenCalled()
  })

  it('我的技能提示仍展示已登录的员工姓名', async () => {
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('tab', { name: 'My skills' }))

    expect((await view.findByText('Skills configured for Employee, with all their versions.')).textContent)
      .toBe('Skills configured for Employee, with all their versions.')
  })

  it('切换本地页时等待登录态重新确认，失效后不展示或请求技能', async () => {
    vi.mocked(loadSkillHub).mockImplementation(() => new Promise<void>(() => {}))
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('private-skill', 'user-dsh')] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await waitFor(() => expect(view.queryByText('No enterprise skills yet.')).toBeNull())

    expect(view.queryByText('private-skill')).toBeNull()
    expect(getSkills).not.toHaveBeenCalled()
    expect(postSkillsRefresh).not.toHaveBeenCalled()
    act(() => store.skill.setEmployee(null))
    expect((await view.findByText('Sign in required')).textContent).toBe('Sign in required')
    expect(getSkills).not.toHaveBeenCalled()
    expect(postSkillsRefresh).not.toHaveBeenCalled()
  })

  it('不加载扩展面板也能展示内核技能与下载的技能', async () => {
    vi.mocked(getSkills).mockResolvedValue({
      skills: [localSkill('builtin-skill', 'bundled'), localSkill('downloaded-skill', 'user-dsh')],
    })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))

    expect((await view.findByText('builtin-skill')).textContent).toBe('builtin-skill')
    expect(view.getByText('downloaded-skill').textContent).toBe('downloaded-skill')
    expect(view.getByRole('button', { name: 'Edit' }).textContent).toBe('Edit')
    expect(view.getByRole('button', { name: 'Delete' }).textContent).toBe('Delete')
    expect(view.queryByRole('tab', { name: 'MCP' })).toBeNull()
    expect(getSkills).toHaveBeenCalledTimes(1)
    expect(postSkillsRefresh).toHaveBeenCalledTimes(1)
  })

  it('下载完成后切换到本地页会从内核重新获取技能', async () => {
    const rows = [localSkill('builtin-skill', 'bundled')]
    vi.mocked(getSkills).mockImplementation(async () => ({ skills: [...rows] }))
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getLocalSkill).mockResolvedValue({ status: 'ready' })
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['downloaded-skill']))
    store.skill.setCommon([summary('downloaded-skill')])
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('button', { name: 'Download skill downloaded-skill' }))
    await waitFor(() => expect(getLocalSkill).toHaveBeenCalledWith(
      { name: 'downloaded-skill' },
      { timeout: 6500 },
    ))
    expect(invoke).toHaveBeenCalledWith(
      'desktop_install_employee_skill',
      { skillName: 'downloaded-skill' },
      { timeoutMs: 90000 },
    )
    rows.push(localSkill('downloaded-skill', 'user-dsh'))
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    expect((await view.findByText('downloaded-skill')).textContent).toBe('downloaded-skill')

    fireEvent.click(view.getByRole('tab', { name: 'Enterprise skills' }))
    await waitFor(() => expect(view.getByRole('tab', { name: 'Enterprise skills' }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await waitFor(() => expect(getSkills).toHaveBeenCalledTimes(2))
    expect(postSkillsRefresh).toHaveBeenCalledTimes(2)
    expect((await view.findByText('downloaded-skill')).textContent).toBe('downloaded-skill')
  })

  it('下载和删除后企业及个人列表同步更新按钮状态', async () => {
    let rows = [localSkill('demo', 'user-dsh')]
    vi.mocked(getSkills).mockImplementation(async () => ({ skills: rows }))
    vi.mocked(deleteSkill).mockImplementation(async () => {
      rows = []
      return { ok: true }
    })
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getLocalSkill).mockResolvedValue({ status: 'ready' })
    vi.mocked(getInstalledSkills)
      .mockResolvedValueOnce(installed(['demo']))
      .mockResolvedValueOnce(installed([]))
    store.skill.setCommon([summary('demo')])
    store.skill.setMine({
      userId: 'E1',
      skillNames: ['demo'],
      skills: [{ summary: summary('demo'), versions: [] }],
      failed: [],
    })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('button', { name: 'Download skill demo' }))
    expect((await view.findByRole('button', { name: 'Downloaded skill demo' })).hasAttribute('disabled')).toBe(true)
    fireEvent.click(view.getByRole('tab', { name: 'My skills' }))
    expect((await view.findByRole('button', { name: 'Downloaded skill demo' })).hasAttribute('disabled')).toBe(true)

    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('demo')
    fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    await view.findByText('Delete this skill?')
    fireEvent.click(view.getAllByRole('button', { name: 'Delete' }).at(-1)!)
    await waitFor(() => expect(store.skill.installedNames).toEqual([]))
    fireEvent.click(view.getByRole('tab', { name: 'Enterprise skills' }))
    expect((await view.findByRole('button', { name: 'Download skill demo' })).hasAttribute('disabled')).toBe(false)
  })

  it('本地页搜索后可通过独立接口停用目标技能', async () => {
    vi.mocked(getSkills).mockResolvedValue({
      skills: [localSkill('builtin-skill', 'bundled'), localSkill('downloaded-skill', 'user-dsh')],
    })
    vi.mocked(postSkillPolicy).mockResolvedValue({ ok: true })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')

    fireEvent.change(view.getByRole('searchbox', { name: 'Search name or description' }), { target: { value: 'downloaded' } })
    await waitFor(() => expect(view.queryByText('builtin-skill')).toBeNull())
    fireEvent.click(view.getByRole('switch', { name: 'Toggle skill loading' }))

    await waitFor(() => expect(postSkillPolicy).toHaveBeenCalledExactlyOnceWith({
      name: 'downloaded-skill',
      enabled: false,
    }))
  })

  it('本地页不再显示技能管理说明文字', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    expect(view.queryByText('View and manage discovered skills, including user and repository skills. Each card switch controls loading.')).toBeNull()
  })

  it('本地页不再显示来源分类，仍展示全部技能和卡片来源', async () => {
    vi.mocked(getSkills).mockResolvedValue({
      skills: [localSkill('builtin-skill', 'bundled'), localSkill('downloaded-skill', 'user-dsh')],
    })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')

    expect(view.queryByRole('group', { name: 'Source' })).toBeNull()
    expect(view.getByText('builtin-skill').textContent).toBe('builtin-skill')
    expect(view.getByText('downloaded-skill').textContent).toBe('downloaded-skill')
    const cards = within(view.getByRole('list'))
    expect(cards.getByText('bundled').textContent).toBe('bundled')
    expect(cards.getByText('user').textContent).toBe('user')
  })

  it('编辑本地技能时保存描述、调用权限与正文', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    vi.mocked(getSkill).mockResolvedValue({ name: 'downloaded-skill', content: 'Original instructions' })
    vi.mocked(postSkill).mockResolvedValue({ ok: true, name: 'downloaded-skill' })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    await view.findByDisplayValue('Original instructions')

    fireEvent.change(view.getByLabelText('Description'), { target: { value: 'Updated description' } })
    await view.findByDisplayValue('Updated description')
    fireEvent.change(view.getByLabelText('When to use (optional)'), { target: { value: 'Use for review' } })
    await view.findByDisplayValue('Use for review')
    fireEvent.click(view.getByRole('checkbox', { name: 'User-invocable (/)' }))
    await waitFor(() => expect((view.getByRole('checkbox', { name: 'User-invocable (/)' }) as HTMLInputElement).checked).toBe(false))
    fireEvent.change(view.getByDisplayValue('Original instructions'), { target: { value: 'Updated instructions' } })
    await view.findByDisplayValue('Updated instructions')
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(postSkill).toHaveBeenCalledExactlyOnceWith({
      name: 'downloaded-skill',
      description: 'Updated description',
      whenToUse: 'Use for review',
      modelInvocable: true,
      userInvocable: false,
      content: 'Updated instructions',
    }))
    await waitFor(() => expect(view.queryByDisplayValue('Updated instructions')).toBeNull())
    expect(getSkills).toHaveBeenCalledTimes(2)
  })

  it('保存技能返回错误时保留编辑内容并显示错误', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    vi.mocked(getSkill).mockResolvedValue({ name: 'downloaded-skill', content: 'Original instructions' })
    vi.mocked(postSkill).mockResolvedValue({ error: 'write denied' })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')
    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    await view.findByDisplayValue('Original instructions')

    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    expect((await view.findByRole('alert')).textContent).toBe('write denied')
    expect(view.getByDisplayValue('Original instructions')).not.toBeNull()
    expect(getSkills).toHaveBeenCalledTimes(1)
  })

  it('启停失败时显示具体错误，不刷新成成功状态', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    vi.mocked(postSkillPolicy).mockResolvedValue({ error: 'policy denied' })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')

    fireEvent.click(view.getByRole('switch', { name: 'Toggle skill loading' }))

    expect((await view.findByRole('alert')).textContent).toBe('Operation failed: policy denied')
    expect(getSkills).toHaveBeenCalledTimes(1)
    expect(view.getByRole('switch', { name: 'Toggle skill loading' }).getAttribute('aria-checked')).toBe('true')
  })

  it('只读技能可安全预览 Markdown，不能编辑或保存', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('builtin-skill', 'bundled')] })
    vi.mocked(getSkill).mockResolvedValue({
      name: 'builtin-skill',
      content: '# Read-only instructions\n<img src="x" onerror="alert(1)">',
    })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('builtin-skill')

    fireEvent.click(view.getByRole('button', { name: 'View' }))

    expect((await view.findByText('Read-only instructions')).tagName).toBe('H1')
    expect(view.container.querySelector('[onerror]')).toBeNull()
    expect(view.queryByRole('button', { name: 'Save' })).toBeNull()
    expect((view.getByLabelText('Description') as HTMLInputElement).disabled).toBe(true)
  })

  it('本地页仍可打开单个技能目录', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    vi.mocked(postOpenDir).mockResolvedValue({ ok: true })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')

    fireEvent.click(view.getByRole('button', { name: 'Open folder' }))

    await waitFor(() => expect(postOpenDir).toHaveBeenCalledExactlyOnceWith({ target: 'skill', name: 'downloaded-skill' }))
  })

  it('恢复顶部入口后可以打开用户技能目录', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    vi.mocked(postOpenDir).mockResolvedValue({ ok: true })
    const view = render(<LocalSkills t={locale.text} createSkill={createSkill} showDirectoryAndImport />)
    await view.findByText('No skills discovered yet')

    fireEvent.click(view.getByRole('button', { name: 'Open skills folder' }))

    await waitFor(() => expect(postOpenDir).toHaveBeenCalledExactlyOnceWith({ target: 'user-skills' }))
  })

  it('本地页可查看技能正文并确认删除', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    vi.mocked(getSkill).mockResolvedValue({ name: 'downloaded-skill', content: 'Skill instructions' })
    vi.mocked(deleteSkill).mockResolvedValue({ ok: true })
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['downloaded-skill'])
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')

    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    expect((await view.findByDisplayValue('Skill instructions')).textContent).toBe('Skill instructions')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(view.queryByDisplayValue('Skill instructions')).toBeNull())
    fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    await view.findByText('Delete this skill?')
    fireEvent.click(view.getAllByRole('button', { name: 'Delete' }).at(-1)!)

    await waitFor(() => expect(deleteSkill).toHaveBeenCalledExactlyOnceWith({ name: 'downloaded-skill' }))
    await waitFor(() => expect(store.skill.installedNames).toEqual([]))
  })

  it('删除返回失败时保留确认窗口并显示错误', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('downloaded-skill', 'user-dsh')] })
    vi.mocked(deleteSkill).mockResolvedValue({ ok: false })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('downloaded-skill')
    fireEvent.click(view.getByRole('button', { name: 'Delete' }))
    await view.findByText('Delete this skill?')

    fireEvent.click(view.getAllByRole('button', { name: 'Delete' }).at(-1)!)

    expect((await view.findByRole('alert')).textContent).toBe('Operation did not complete')
    expect(view.getByText('Delete this skill?').textContent).toBe('Delete this skill?')
    expect(getSkills).toHaveBeenCalledTimes(1)
  })

  it('恢复顶部入口后可通过独立接口导入技能仓库', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    vi.mocked(postRoots).mockResolvedValue({
      ok: true,
      root: { id: 'git-1', kind: 'git', label: 'owner/repo', roots: [], addedAt: 1, live: true },
    })
    const view = render(<LocalSkills t={locale.text} createSkill={createSkill} showDirectoryAndImport />)
    await view.findByText('No skills discovered yet')
    fireEvent.click(view.getByRole('button', { name: 'Import repository' }))
    fireEvent.change(await view.findByPlaceholderText('owner/repo'), { target: { value: 'owner/repo' } })

    await waitFor(() => expect(view.getAllByRole('button', { name: 'Import repository' }).at(-1)!.hasAttribute('disabled')).toBe(false))
    fireEvent.click(view.getAllByRole('button', { name: 'Import repository' }).at(-1)!)

    await waitFor(() => expect(postRoots).toHaveBeenCalledExactlyOnceWith({
      kind: 'git',
      url: 'https://github.com/owner/repo',
    }))
  })

  it('输入非法仓库地址时显示错误且不请求导入接口', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<LocalSkills t={locale.text} createSkill={createSkill} showDirectoryAndImport />)
    await view.findByText('No skills discovered yet')
    fireEvent.click(view.getByRole('button', { name: 'Import repository' }))
    fireEvent.change(await view.findByPlaceholderText('owner/repo'), { target: { value: 'https://other.example/repo' } })
    await waitFor(() => expect(view.getAllByRole('button', { name: 'Import repository' }).at(-1)!.hasAttribute('disabled')).toBe(false))

    fireEvent.click(view.getAllByRole('button', { name: 'Import repository' }).at(-1)!)

    expect((await view.findByRole('alert')).textContent).toBe('Enter a valid GitHub URL or owner/repo.')
    expect(postRoots).not.toHaveBeenCalled()
  })

  it('本地页新建技能调用创建动作且不发起上传', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    fireEvent.click(view.getByRole('button', { name: 'New skill' }))

    await waitFor(() => expect(createSkill).toHaveBeenCalledTimes(1))
    expect(invoke).not.toHaveBeenCalled()
  })

  it('本地页选择 ZIP 后沿用鉴权上传并刷新我的技能', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    store.skill.setManageUser('E1')
    mockUploadBridge(async () => ({ skillName: 'demo', version: '1.0.0' }))
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')
    const input = uploadInput(view.container)
    const picker = vi.spyOn(input, 'click').mockImplementation(() => {})
    const file = uploadFile()

    fireEvent.click(view.getByRole('button', { name: 'Upload skill' }))
    expect(picker).toHaveBeenCalledOnce()
    expect(input.accept).toBe('.zip,application/zip,application/x-zip-compressed')
    fireEvent.change(input, { target: { files: [file] } })

    expect((await view.findByRole('alert')).textContent).toBe('Uploaded skill demo (version 1.0.0)')
    expect(invoke).toHaveBeenCalledWith('desktop_auth_upload', {
      path: '/api/employee-skills/upload',
      fileName: 'demo.zip',
      contentType: 'application/zip',
      body: [0x50, 0x4B, 0x03, 0x04],
    })
    expect(invoke).toHaveBeenCalledWith('desktop_auth_request', {
      method: 'GET',
      path: '/api/employee-skills/user/E1',
      body: null,
    })
    expect(store.skill.mine?.skillNames).toEqual(['demo'])
    expect(store.skill.manageMine?.skillNames).toEqual(['demo'])
    expect(store.skill.catalog.map(item => item.name)).toEqual(['demo'])
    expect(input.value).toBe('')
  })

  it('取消选择文件不会发起上传', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    fireEvent.change(uploadInput(view.container), { target: { files: [] } })

    expect(invoke).not.toHaveBeenCalled()
    expect(view.getByRole('button', { name: 'Upload skill' }).hasAttribute('disabled')).toBe(false)
  })

  it('上传期间禁用入口，完成后恢复', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    let finishUpload: () => void = () => {
      throw new Error('Upload was not started')
    }
    mockUploadBridge(() => new Promise((resolve) => {
      finishUpload = () => resolve({ skillName: 'demo', version: '1.0.0' })
    }))
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    fireEvent.change(uploadInput(view.container), { target: { files: [uploadFile()] } })

    expect((await view.findByRole('button', { name: 'Uploading…' })).hasAttribute('disabled')).toBe(true)
    await act(async () => finishUpload())
    expect((await view.findByRole('button', { name: 'Upload skill' })).hasAttribute('disabled')).toBe(false)
  })

  it('上传失败时显示错误并恢复上传入口', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    mockUploadBridge(async () => {
      throw new Error('upload denied')
    })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    fireEvent.change(uploadInput(view.container), { target: { files: [uploadFile()] } })

    expect((await view.findByRole('alert')).textContent).toBe('Operation failed: upload denied')
    expect((await view.findByRole('button', { name: 'Upload skill' })).hasAttribute('disabled')).toBe(false)
  })

  it('创建会话期间禁用新建入口以防重复创建', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    let finishCreation: () => void = () => {
      throw new Error('Creation was not started')
    }
    createSkill.mockImplementationOnce(() => new Promise((resolve) => {
      finishCreation = () => resolve()
    }))
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')
    const button = view.getByRole('button', { name: 'New skill' })

    fireEvent.click(button)

    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    fireEvent.click(button)
    expect(createSkill).toHaveBeenCalledTimes(1)
    await act(async () => finishCreation())
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
  })

  it('创建技能失败时显示具体错误', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    createSkill.mockRejectedValueOnce(new Error('workspace unavailable'))
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))
    await view.findByText('No skills discovered yet')

    fireEvent.click(view.getByRole('button', { name: 'New skill' }))

    expect((await view.findByRole('alert')).textContent).toBe('Operation failed: Could not start skill creator: workspace unavailable')
  })

  it('企业技能加载中或失败时不阻塞本地页', async () => {
    vi.mocked(getSkills).mockResolvedValue({ skills: [localSkill('builtin-skill', 'bundled')] })
    store.skill.setError('Enterprise API unavailable')
    store.skill.setLoading(true)
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)

    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))

    expect((await view.findByText('builtin-skill')).textContent).toBe('builtin-skill')
    expect(view.queryByText('Enterprise API unavailable')).toBeNull()
  })

  it('本地接口失败时显示错误，刷新成功后恢复列表', async () => {
    vi.mocked(postSkillsRefresh)
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce({ skills: [localSkill('builtin-skill', 'bundled')] })
    const view = render(<SkillHubPanel t={locale.text} createSkill={createSkill} />)
    fireEvent.click(view.getByRole('tab', { name: 'Local skills' }))

    expect((await view.findByRole('alert')).textContent).toBe('Operation failed: HTTP 404')
    expect(view.queryByText('No skills discovered yet')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Refresh' }))
    expect((await view.findByText('builtin-skill')).textContent).toBe('builtin-skill')
    expect(view.queryByRole('alert')).toBeNull()
  })
})
