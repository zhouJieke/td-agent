import type { EmployeeDeptVO, EmployeeProfile, SkillPage, UserSkillDetails } from '../types'
import { invoke } from 'dsh-tauri/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteSkill, getInstalledSkills, getLocalSkill, getSkill, getSkills, postSkillsRefresh } from '../apis'
import { store } from '../store'
import { fetchAuth } from './auth'
import { deleteLocalSkill } from './local-skills'
import { fetchCatalogSkills, fetchCommonSkills, fetchEmployees, fetchUserProfile, fetchUserSkills, saveUserSkills, uploadSkillZip } from './remote'
import { closeSkillDetail, downloadSkill, fetchInstalledSkills, fetchSkillTab, loadSkillHub, openSkillDetail, saveUserSkillNames, selectManageUser, updateSkill, uploadMySkill } from './skill'

vi.mock('dsh-tauri/client', async importOriginal => ({
  ...await importOriginal<typeof import('dsh-tauri/client')>(),
  invoke: vi.fn(),
}))

vi.mock('./remote', () => ({
  fetchCommonSkills: vi.fn(),
  fetchCatalogSkills: vi.fn(),
  fetchUserSkills: vi.fn(),
  fetchUserProfile: vi.fn(),
  saveUserSkills: vi.fn(),
  fetchEmployees: vi.fn(),
  uploadSkillZip: vi.fn(),
}))

vi.mock('./auth', () => ({
  fetchAuth: vi.fn(),
}))

vi.mock('../apis', async importOriginal => ({
  ...await importOriginal<typeof import('../apis')>(),
  deleteSkill: vi.fn(),
  getInstalledSkills: vi.fn(),
  getLocalSkill: vi.fn(),
  getSkill: vi.fn(),
  getSkills: vi.fn(),
  postSkillsRefresh: vi.fn(),
}))

function installed(names: string[], versions: Record<string, string> = {}, updatableNames = names) {
  return { names, versions, updatableNames }
}

function page(names: string[]): SkillPage {
  return {
    totalCount: names.length,
    pageNumber: 1,
    pagesAvailable: 1,
    items: names.map(name => ({
      namespaceId: 'ns',
      name,
      description: `${name} description`,
      updateTime: 0,
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
    })),
  }
}

function mine(userId: string, names: string[]): UserSkillDetails {
  return { userId, skillNames: names, skills: [], failed: [] }
}

const PROFILE: EmployeeProfile = { userId: 'E10001', employeeName: '张三', departmentName: '技术部' }
const EMPLOYEES: EmployeeDeptVO[] = [
  { userId: 'E10001', employeeName: '张三', departmentName: '技术部' },
  { userId: 'E10002', employeeName: '李四', departmentName: null },
]

beforeEach(() => {
  store.skill.setTab('enterprise')
  store.skill.resetLoadedTabs()
  store.skill.setEmployee({ employeeNumber: 'E10001', employeeName: '张三' })
  store.skill.setCommon([])
  store.skill.setCatalog([])
  store.skill.setMine(null)
  store.skill.setProfile(null)
  store.skill.setEmployees([])
  store.skill.setManageUser('')
  store.skill.setManageMine(null)
  store.skill.setManageLoading(false)
  store.skill.setError('')
  store.skill.setDetail(null)
  store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), [])
  store.localSkills.reset()
  for (const name of store.skill.downloading)
    store.skill.finishDownload(name)
  store.skill.dismissFeedback()
  vi.mocked(fetchAuth).mockReset()
  vi.mocked(fetchCommonSkills).mockReset()
  vi.mocked(fetchCatalogSkills).mockReset()
  vi.mocked(fetchUserSkills).mockReset()
  vi.mocked(fetchUserProfile).mockReset()
  vi.mocked(saveUserSkills).mockReset()
  vi.mocked(fetchEmployees).mockReset()
  vi.mocked(uploadSkillZip).mockReset()
  vi.mocked(invoke).mockReset()
  vi.mocked(getLocalSkill).mockReset()
  vi.mocked(getLocalSkill).mockResolvedValue({ status: 'ready' })
  vi.mocked(getInstalledSkills).mockReset()
  vi.mocked(getInstalledSkills).mockResolvedValue(installed([]))
  vi.mocked(getSkill).mockReset()
  vi.mocked(getSkills).mockReset()
  vi.mocked(deleteSkill).mockReset()
  vi.mocked(postSkillsRefresh).mockReset()
  vi.mocked(postSkillsRefresh).mockResolvedValue({ skills: [] })
})

describe('登录态编排', () => {
  it('未登录时止步，不拉取技能数据', async () => {
    store.skill.startAuth()
    vi.mocked(fetchAuth).mockImplementation(async () => {
      store.skill.setEmployee(null)
      return true
    })

    await loadSkillHub()

    expect(vi.mocked(fetchAuth)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchCommonSkills)).not.toHaveBeenCalled()
    expect(getInstalledSkills).not.toHaveBeenCalled()
    expect(store.skill.employee).toBeNull()
    expect(store.skill.authChecked).toBe(true)
  })

  it('企业页只拉取公用技能与本地安装态', async () => {
    store.skill.startAuth()
    vi.mocked(fetchAuth).mockImplementation(async () => {
      store.skill.setEmployee({ employeeNumber: 'E10001', employeeName: '张三' })
      return true
    })
    vi.mocked(fetchCommonSkills).mockResolvedValue(page(['a']))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['a']))

    await loadSkillHub()

    expect(vi.mocked(fetchAuth)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchCommonSkills)).toHaveBeenCalledTimes(1)
    expect(store.skill.common).toHaveLength(1)
    expect(store.skill.loadedTabs).toEqual(['enterprise'])
    expect(getInstalledSkills).toHaveBeenCalledExactlyOnceWith({ timeout: 6_500 })
    expect(store.skill.installedNames).toEqual(['a'])
    expect(fetchCatalogSkills).not.toHaveBeenCalled()
    expect(fetchUserSkills).not.toHaveBeenCalled()
    expect(fetchUserProfile).not.toHaveBeenCalled()
    expect(fetchEmployees).not.toHaveBeenCalled()
  })

  it('已登录时重新装配不再探测登录态', async () => {
    store.skill.setTab('enterprise')
    vi.mocked(fetchCommonSkills).mockResolvedValue(page(['a']))

    await loadSkillHub()

    expect(vi.mocked(fetchAuth)).not.toHaveBeenCalled()
    expect(store.skill.common.map(item => item.name)).toEqual(['a'])
    expect(store.skill.loadedTabs).toEqual(['enterprise'])
  })

  it('已登录的本地技能页只检查登录态，不请求企业技能接口', async () => {
    store.skill.startAuth()
    store.skill.setTab('local')
    vi.mocked(fetchAuth).mockImplementation(async () => {
      store.skill.setEmployee({ employeeNumber: 'E10001', employeeName: '张三' })
      return true
    })

    await loadSkillHub()

    expect(fetchAuth).toHaveBeenCalledOnce()
    expect(fetchCommonSkills).not.toHaveBeenCalled()
    expect(fetchCatalogSkills).not.toHaveBeenCalled()
    expect(fetchUserSkills).not.toHaveBeenCalled()
    expect(getInstalledSkills).not.toHaveBeenCalled()
  })
})

describe('切换页签强制刷新', () => {
  it('重复装配同一页签也强制重拉，反映后台增删', async () => {
    vi.mocked(fetchCommonSkills)
      .mockResolvedValueOnce(page(['a']))
      .mockResolvedValueOnce(page(['b']))

    await loadSkillHub()
    expect(store.skill.common.map(item => item.name)).toEqual(['a'])

    await loadSkillHub()

    expect(fetchCommonSkills).toHaveBeenCalledTimes(2)
    expect(store.skill.common.map(item => item.name)).toEqual(['b'])
  })

  it('切走再切回企业页签时强制重拉最新数据', async () => {
    vi.mocked(fetchCommonSkills)
      .mockResolvedValueOnce(page(['old']))
      .mockResolvedValueOnce(page(['new']))

    await loadSkillHub()
    store.skill.setTab('local')
    await loadSkillHub()
    store.skill.setTab('enterprise')
    await loadSkillHub()

    expect(fetchCommonSkills).toHaveBeenCalledTimes(2)
    expect(store.skill.common.map(item => item.name)).toEqual(['new'])
  })

  it('本地技能页不触发企业技能请求', async () => {
    store.skill.setTab('local')

    await loadSkillHub()

    expect(fetchCommonSkills).not.toHaveBeenCalled()
    expect(getInstalledSkills).not.toHaveBeenCalled()
  })
})

describe('按页签拉取技能数据', () => {
  it('企业页只拉取企业公用技能', async () => {
    vi.mocked(fetchCommonSkills).mockResolvedValue(page(['a', 'b']))

    await fetchSkillTab('E10001', 'enterprise')

    expect(store.skill.common.map(item => item.name)).toEqual(['a', 'b'])
    expect(store.skill.loadedTabs).toEqual(['enterprise'])
    expect(store.skill.error).toBe('')
    expect(fetchCatalogSkills).not.toHaveBeenCalled()
    expect(fetchUserSkills).not.toHaveBeenCalled()
    expect(fetchUserProfile).not.toHaveBeenCalled()
    expect(fetchEmployees).not.toHaveBeenCalled()
  })

  it('管理页拉取全量目录与员工列表并默认选中当前用户，员工列表失败退化为空', async () => {
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page(['a', 'b']))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['a']))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockRejectedValue(new Error('employees unavailable'))

    await fetchSkillTab('E10001', 'manage')

    expect(store.skill.catalog.map(item => item.name)).toEqual(['a', 'b'])
    expect(store.skill.employees).toEqual([])
    expect(store.skill.manageUserId).toBe('E10001')
    expect(store.skill.manageMine?.skillNames).toEqual(['a'])
    expect(store.skill.error).toBe('')
    expect(fetchCommonSkills).not.toHaveBeenCalled()
  })

  it('已加载过的页签不重复请求，强制刷新时忽略标记', async () => {
    vi.mocked(fetchCommonSkills)
      .mockResolvedValueOnce(page(['a']))
      .mockResolvedValueOnce(page(['b']))

    await fetchSkillTab('E10001', 'enterprise')
    await fetchSkillTab('E10001', 'enterprise')

    expect(fetchCommonSkills).toHaveBeenCalledExactlyOnceWith()
    expect(store.skill.common.map(item => item.name)).toEqual(['a'])

    await fetchSkillTab('E10001', 'enterprise', true)

    expect(fetchCommonSkills).toHaveBeenCalledTimes(2)
    expect(store.skill.common.map(item => item.name)).toEqual(['b'])
  })

  it('主数据失败落错误信息且不标记已加载', async () => {
    vi.mocked(fetchCommonSkills).mockRejectedValue(new Error('技能服务未启用'))

    await fetchSkillTab('E10001', 'enterprise')

    expect(store.skill.error).toBe('技能服务未启用')
    expect(store.skill.loadedTabs).toEqual([])
  })

  it('登录态变化后迟到的响应不写回旧员工的数据', async () => {
    let resolveCommon: (value: SkillPage) => void = () => {}
    vi.mocked(fetchCommonSkills).mockReturnValue(new Promise<SkillPage>((resolve) => {
      resolveCommon = resolve
    }))

    const task = fetchSkillTab('E10001', 'enterprise')
    store.skill.setEmployee(null)
    resolveCommon(page(['late']))
    await task

    expect(store.skill.common).toEqual([])
    expect(store.skill.error).toBe('')
  })
})

describe('配置对象切换', () => {
  it('切换员工时拉取该员工已配置的技能名单', async () => {
    store.skill.setManageUser('E10001')
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10002', ['b']))

    await selectManageUser('E10002')

    expect(vi.mocked(fetchUserSkills)).toHaveBeenCalledWith('E10002')
    expect(store.skill.manageUserId).toBe('E10002')
    expect(store.skill.manageMine?.skillNames).toEqual(['b'])
    expect(store.skill.manageLoading).toBe(false)
  })

  it('选中同一员工时不重复请求', async () => {
    store.skill.setManageUser('E10001')

    await selectManageUser('E10001')

    expect(vi.mocked(fetchUserSkills)).not.toHaveBeenCalled()
  })

  it('拉取失败清空目标名单并给出 failed 反馈', async () => {
    store.skill.setManageUser('E10001')
    vi.mocked(fetchUserSkills).mockRejectedValue(new Error('nacos unreachable'))

    await selectManageUser('E10002')

    expect(store.skill.manageMine).toBeNull()
    expect(store.skill.manageLoading).toBe(false)
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: 'nacos unreachable' })
  })
})

describe('技能名单保存', () => {
  it('保存成功后回拉最新名单，反馈名优先「姓名 · 部门」', async () => {
    store.skill.setEmployees(EMPLOYEES)
    vi.mocked(saveUserSkills).mockResolvedValue(true)
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['a', 'b']))

    const result = await saveUserSkillNames('E10001', ['a', 'b'])

    expect(result).toEqual({ ok: true })
    expect(vi.mocked(saveUserSkills)).toHaveBeenCalledWith('E10001', ['a', 'b'])
    expect(store.skill.mine?.skillNames).toEqual(['a', 'b'])
    expect(store.skill.manageMine?.skillNames).toEqual(['a', 'b'])
    expect(store.skill.feedback).toMatchObject({ kind: 'saved', name: '张三 · 技术部', count: 2 })
  })

  it('保存他人名单时只更新目标名单，不动当前用户数据', async () => {
    store.skill.setEmployees(EMPLOYEES)
    store.skill.setMine(mine('E10001', ['a']))
    vi.mocked(saveUserSkills).mockResolvedValue(true)
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10002', ['b']))

    await saveUserSkillNames('E10002', ['b'])

    expect(store.skill.mine?.skillNames).toEqual(['a'])
    expect(store.skill.manageMine?.skillNames).toEqual(['b'])
    expect(store.skill.feedback).toMatchObject({ kind: 'saved', name: '李四', count: 1 })
  })

  it('保存失败给出 failed 反馈', async () => {
    vi.mocked(saveUserSkills).mockRejectedValue(new Error('技能名称数组不能为空'))

    const result = await saveUserSkillNames('E10001', [])

    expect(result).toEqual({ ok: false, error: '技能名称数组不能为空' })
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: '技能名称数组不能为空' })
  })
})

describe('我的技能上传', () => {
  it('上传成功后刷新我的技能和全量目录，并给出 uploaded 反馈', async () => {
    store.skill.setManageUser('E10001')
    vi.mocked(uploadSkillZip).mockResolvedValue({ skillName: 'demo-skill', version: '1.0.0' })
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['a', 'demo-skill']))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page(['a', 'demo-skill']))

    const file = { name: 'demo.zip' } as File
    const result = await uploadMySkill(file)

    expect(result).toEqual({ ok: true })
    expect(vi.mocked(uploadSkillZip)).toHaveBeenCalledWith(file)
    expect(store.skill.mine?.skillNames).toEqual(['a', 'demo-skill'])
    expect(store.skill.manageMine?.skillNames).toEqual(['a', 'demo-skill'])
    expect(store.skill.catalog.map(item => item.name)).toEqual(['a', 'demo-skill'])
    expect(store.skill.feedback).toMatchObject({ kind: 'uploaded', skillName: 'demo-skill', version: '1.0.0' })
  })

  it('上传失败给出 failed 反馈', async () => {
    vi.mocked(uploadSkillZip).mockRejectedValue(new Error('技能 ZIP 不能为空且不能超过 10 MB'))

    const result = await uploadMySkill({ name: 'bad.zip' } as File)

    expect(result).toEqual({ ok: false, error: '技能 ZIP 不能为空且不能超过 10 MB' })
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: '技能 ZIP 不能为空且不能超过 10 MB' })
  })
})

describe('技能下载与安装', () => {
  it('安装成功后提示可使用的技能命令', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo-skill']))

    await expect(downloadSkill('demo-skill')).resolves.toEqual({ ok: true })

    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'desktop_install_employee_skill',
      { skillName: 'demo-skill' },
      { timeoutMs: 90_000 },
    )
    expect(store.skill.downloading).toEqual([])
    expect(store.skill.installedNames).toEqual(['demo-skill'])
    expect(getLocalSkill).toHaveBeenCalledExactlyOnceWith({ name: 'demo-skill' }, { timeout: 6_500 })
    expect(store.skill.feedback).toMatchObject({ kind: 'downloaded', skillName: 'demo-skill', status: 'ready' })
  })

  it('下载期间保持对应技能的繁忙状态并阻止重复请求', async () => {
    let finish!: () => void
    vi.mocked(invoke).mockReturnValue(new Promise<void>((resolve) => {
      finish = resolve
    }))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo']))

    const first = downloadSkill('demo')
    expect(store.skill.downloading).toEqual(['demo'])
    await expect(downloadSkill('demo')).resolves.toEqual({ ok: false, error: 'SKILL_DOWNLOAD_IN_PROGRESS' })
    expect(invoke).toHaveBeenCalledTimes(1)
    finish()
    await expect(first).resolves.toEqual({ ok: true })
    expect(store.skill.downloading).toEqual([])
  })

  it('安装失败释放繁忙状态并展示具体错误', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_DOWNLOAD_HTTP_404: skill unavailable'))

    await expect(downloadSkill('missing')).resolves.toEqual({
      ok: false,
      error: 'SKILL_DOWNLOAD_HTTP_404: skill unavailable',
    })
    expect(store.skill.downloading).toEqual([])
    expect(store.skill.feedback).toMatchObject({
      kind: 'failed',
      error: 'SKILL_DOWNLOAD_HTTP_404: skill unavailable',
    })
  })

  it('已安装但被同名技能遮蔽时不提示可立即调用', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getLocalSkill).mockResolvedValue({ status: 'shadowed' })
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo']))

    await expect(downloadSkill('demo')).resolves.toEqual({ ok: true })

    expect(store.skill.feedback).toMatchObject({ kind: 'downloaded', skillName: 'demo', status: 'shadowed' })
  })

  it('安装完成后无法确认内核状态时保留文件并显示错误详情', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getLocalSkill).mockRejectedValue(new Error('kernel unavailable'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo']))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(downloadSkill('demo')).resolves.toEqual({ ok: true })

    expect(store.skill.feedback).toMatchObject({
      kind: 'downloaded',
      skillName: 'demo',
      status: 'unavailable',
      detail: 'kernel unavailable',
    })
    expect(log).toHaveBeenCalledOnce()
    expect(store.skill.installedNames).toEqual(['demo'])
    log.mockRestore()
  })

  it('安装完成后立即更新状态，不等待内核验证', async () => {
    let finish!: (result: { status: 'pending' }) => void
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo']))
    vi.mocked(getLocalSkill).mockReturnValue(new Promise((resolve) => {
      finish = resolve
    }))

    const pending = downloadSkill('demo')

    await vi.waitFor(() => expect(store.skill.installedNames).toEqual(['demo']))
    expect(store.skill.downloading).toEqual(['demo'])
    finish({ status: 'pending' })
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('安装成功但本地状态复核失败时保留已安装结果并显示错误', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getInstalledSkills).mockRejectedValue(new Error('disk unavailable'))

    await expect(downloadSkill('demo')).resolves.toEqual({ ok: true })

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(store.skill.installedChecked).toBe(false)
    expect(store.skill.installedError).toBe('disk unavailable')
  })

  it('较早的状态查询不能覆盖下载完成后的结果', async () => {
    let finishOld!: (result: ReturnType<typeof installed>) => void
    vi.mocked(getInstalledSkills)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce(installed(['demo']))
    vi.mocked(invoke).mockResolvedValue(undefined)

    const oldRequest = fetchInstalledSkills()
    await downloadSkill('demo')
    finishOld(installed([]))
    await oldRequest

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(store.skill.installedLoading).toBe(false)
  })

  it('原生安装发现同名技能时重新读取本地状态', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_ALREADY_EXISTS: demo'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo']))

    await expect(downloadSkill('demo')).resolves.toEqual({ ok: false, error: 'SKILL_ALREADY_EXISTS: demo' })

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: 'SKILL_ALREADY_EXISTS: demo' })
  })

  it('已知安装的技能不会再次发起原生下载', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])

    await expect(downloadSkill('demo')).resolves.toEqual({ ok: false, error: 'SKILL_ALREADY_EXISTS: demo' })

    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('技能版本更新', () => {
  it('更新已安装旧版后刷新内核和本地版本', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockResolvedValue('1.1.0')
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.1.0' }))

    await expect(updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' })).resolves.toEqual({ ok: true })

    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'desktop_update_employee_skill',
      { skillName: 'demo', expectedVersion: '1.1.0', installedVersion: '1.0.0' },
      { timeoutMs: 90_000 },
    )
    expect(postSkillsRefresh).toHaveBeenCalledOnce()
    expect(getLocalSkill).toHaveBeenCalledExactlyOnceWith({ name: 'demo' }, { timeout: 6_500 })
    expect(store.skill.installedVersions).toEqual({ demo: '1.1.0' })
    expect(store.skill.feedback).toMatchObject({ kind: 'updated', skillName: 'demo', status: 'ready' })
  })

  it('确认旧技能版本未知后传递空版本并使用实际下载版本', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['legacy'], {}, ['legacy'])
    vi.mocked(invoke).mockResolvedValue('2.0.0')
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['legacy'], { legacy: '2.0.0' }))

    await expect(updateSkill({ name: 'legacy', latestVersion: '2.0.0', installedVersion: null })).resolves.toEqual({ ok: true })

    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      'desktop_update_employee_skill',
      { skillName: 'legacy', expectedVersion: '2.0.0', installedVersion: null },
      { timeoutMs: 90_000 },
    )
    expect(store.skill.installedVersions).toEqual({ legacy: '2.0.0' })
  })

  it('名为 constructor 的旧技能不把对象原型误认为已安装版本', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['constructor'], {}, ['constructor'])
    vi.mocked(invoke).mockResolvedValue('1.0.0')
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['constructor'], { constructor: '1.0.0' }))

    await expect(updateSkill({ name: 'constructor', latestVersion: '1.0.0', installedVersion: null })).resolves.toEqual({ ok: true })

    expect(store.skill.installedVersions.constructor).toBe('1.0.0')
  })

  it('本地目标不允许覆盖时不发起更新', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], {}, [])

    await expect(updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: null }))
      .resolves
      .toEqual({ ok: false, error: 'SKILL_UPDATE_UNAVAILABLE' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('远端版本不是更新版本时不覆盖本地技能', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.1.0' }, ['demo'])

    await expect(updateSkill({ name: 'demo', latestVersion: '1.0.0', installedVersion: '1.1.0' }))
      .resolves
      .toEqual({ ok: false, error: 'SKILL_VERSION_INVALID' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('本地版本已变化时拒绝过期的更新请求', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.1.0' }, ['demo'])

    await expect(updateSkill({ name: 'demo', latestVersion: '1.2.0', installedVersion: '1.0.0' }))
      .resolves
      .toEqual({ ok: false, error: 'SKILL_VERSION_CHANGED' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('下载包版本不一致时保留本地版本并展示错误', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_VERSION_MISMATCH'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.0.0' }))

    await expect(updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' }))
      .resolves
      .toEqual({ ok: false, error: 'SKILL_VERSION_MISMATCH' })
    expect(store.skill.installedVersions).toEqual({ demo: '1.0.0' })
    expect(postSkillsRefresh).not.toHaveBeenCalled()
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: 'SKILL_VERSION_MISMATCH' })
  })

  it('远端最新版本变化时刷新列表并保留本地版本', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_REMOTE_VERSION_CHANGED: latest version changed'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.0.0' }))
    const latest = page(['demo'])
    latest.items[0].labels.latest = '1.2.0'
    vi.mocked(fetchCommonSkills).mockResolvedValue(latest)
    vi.mocked(fetchCatalogSkills).mockResolvedValue(latest)
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['demo']))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockResolvedValue([])

    await expect(updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' }))
      .resolves
      .toEqual({ ok: false, error: 'SKILL_REMOTE_VERSION_CHANGED: latest version changed' })
    expect(fetchCommonSkills).toHaveBeenCalledExactlyOnceWith()
    expect(fetchUserSkills).not.toHaveBeenCalled()
    expect(store.skill.common[0].labels.latest).toBe('1.2.0')
    expect(store.skill.installedVersions).toEqual({ demo: '1.0.0' })
    expect(postSkillsRefresh).not.toHaveBeenCalled()
  })

  it('刷新远端版本期间退出登录不会写回旧员工的技能列表', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_REMOTE_VERSION_CHANGED: latest version changed'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.0.0' }))
    let finish!: (value: SkillPage) => void
    vi.mocked(fetchCommonSkills).mockReturnValue(new Promise((resolve) => {
      finish = resolve
    }))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page(['demo']))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['demo']))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockResolvedValue([])

    const pending = updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' })
    await vi.waitFor(() => expect(fetchCommonSkills).toHaveBeenCalledOnce())
    store.skill.setEmployee(null)
    finish(page(['demo']))
    await pending

    expect(store.skill.common).toEqual([])
    expect(store.skill.mine).toBeNull()
  })

  it('远端版本变化后列表刷新失败时显示具体错误', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_REMOTE_VERSION_CHANGED: latest version changed'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.0.0' }))
    vi.mocked(fetchCommonSkills).mockRejectedValue(new Error('catalog unavailable'))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page(['demo']))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['demo']))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockResolvedValue([])

    await updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' })

    expect(store.skill.error).toBe('catalog unavailable')
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: 'SKILL_REMOTE_VERSION_CHANGED: latest version changed' })
    expect(store.skill.installedVersions).toEqual({ demo: '1.0.0' })
  })

  it('原生命令返回异常版本时提示结果未知并重新读取本地状态', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockResolvedValue('1.2.0')
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.2.0' }))

    await expect(updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' }))
      .resolves
      .toEqual({ ok: false, error: 'SKILL_UPDATE_RESULT_INVALID' })
    expect(store.skill.installedVersions).toEqual({ demo: '1.2.0' })
    expect(store.skill.feedback).toMatchObject({ kind: 'failed', error: 'SKILL_UPDATE_RESULT_INVALID' })
  })

  it('更新文件成功但内核刷新失败时保留新版本并显示警告', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'], { demo: '1.0.0' }, ['demo'])
    vi.mocked(invoke).mockResolvedValue('1.1.0')
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo'], { demo: '1.1.0' }))
    vi.mocked(postSkillsRefresh).mockRejectedValue(new Error('provider unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(updateSkill({ name: 'demo', latestVersion: '1.1.0', installedVersion: '1.0.0' })).resolves.toEqual({ ok: true })

    expect(store.skill.installedVersions).toEqual({ demo: '1.1.0' })
    expect(store.skill.feedback).toMatchObject({ kind: 'updated', status: 'unavailable', detail: 'provider unavailable' })
    expect(log).toHaveBeenCalledOnce()
    log.mockRestore()
  })
})

describe('本地安装状态同步', () => {
  it('读取失败时保留具体错误且不把状态伪装成未安装', async () => {
    vi.mocked(getInstalledSkills).mockRejectedValue(new Error('permission denied'))

    await fetchInstalledSkills()

    expect(store.skill.installedChecked).toBe(false)
    expect(store.skill.installedLoading).toBe(false)
    expect(store.skill.installedError).toBe('permission denied')
  })

  it('接口响应格式错误时显示明确错误', async () => {
    vi.mocked(getInstalledSkills).mockResolvedValue(JSON.parse('{"names":"invalid"}'))

    await fetchInstalledSkills()

    expect(store.skill.installedChecked).toBe(false)
    expect(store.skill.installedError).toBe('SKILL_INSTALLED_STATUS_INVALID')
  })

  it.each([
    installed(['demo'], { demo: 'invalid' }),
    installed(['demo'], { other: '1.0.0' }),
    installed(['demo'], {}, ['other']),
  ])('版本清单不一致时显示明确错误 %#', async (response) => {
    vi.mocked(getInstalledSkills).mockResolvedValue(response)

    await fetchInstalledSkills()

    expect(store.skill.installedChecked).toBe(false)
    expect(store.skill.installedError).toBe('SKILL_INSTALLED_STATUS_INVALID')
  })

  it('较早的查询失败不能覆盖较新的成功结果', async () => {
    let failOld!: (error: Error) => void
    vi.mocked(getInstalledSkills)
      .mockReturnValueOnce(new Promise((_, reject) => { failOld = reject }))
      .mockResolvedValueOnce(installed(['demo']))

    const oldRequest = fetchInstalledSkills()
    await fetchInstalledSkills()
    failOld(new Error('old failure'))
    await oldRequest

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(store.skill.installedChecked).toBe(true)
    expect(store.skill.installedError).toBe('')
  })

  it('删除成功后重新读取磁盘，旧查询不能恢复已删除状态', async () => {
    let finishOld!: (result: ReturnType<typeof installed>) => void
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])
    store.localSkills.setConfirmName('demo')
    vi.mocked(deleteSkill).mockResolvedValue({ ok: true })
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    vi.mocked(getInstalledSkills)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce(installed([]))

    const oldRequest = fetchInstalledSkills()
    await deleteLocalSkill()
    finishOld(installed(['demo']))
    await oldRequest

    expect(store.skill.installedNames).toEqual([])
    expect(store.skill.installedChecked).toBe(true)
  })

  it('删除了其他同名来源但目标目录仍存在时保留已安装状态', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])
    store.localSkills.setConfirmName('demo')
    vi.mocked(deleteSkill).mockResolvedValue({ ok: true })
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    vi.mocked(getInstalledSkills).mockResolvedValue(installed(['demo']))

    await deleteLocalSkill()

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(getInstalledSkills).toHaveBeenCalledExactlyOnceWith({ timeout: 6_500 })
  })

  it('删除接口在移除文件后报错时仍重新检查本地状态', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])
    store.localSkills.setConfirmName('demo')
    vi.mocked(deleteSkill).mockRejectedValue(new Error('provider refresh failed'))
    vi.mocked(getInstalledSkills).mockResolvedValue(installed([]))

    await deleteLocalSkill()

    expect(store.localSkills.formError).toBe('provider refresh failed')
    expect(store.skill.installedNames).toEqual([])
  })
})

describe('只读技能详情', () => {
  const SUMMARY = page(['demo']).items[0]
  const LOCAL_ROW = {
    name: 'demo',
    description: '本地描述',
    whenToUse: '需要时',
    invocation: { modelInvocable: true, userInvocable: false },
    source: 'user',
    provider: 'built-in',
    editable: true,
    removable: true,
    policyEditable: true,
  }
  const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

  it('先展示摘要，本地正文与元数据加载完成后补齐', async () => {
    vi.mocked(getSkill).mockResolvedValue({ name: 'demo', content: '# demo' })
    vi.mocked(getSkills).mockResolvedValue({ skills: [LOCAL_ROW] })

    openSkillDetail(SUMMARY)
    expect(store.skill.detail).toMatchObject({ name: 'demo', local: false, contentLoading: true })

    await flushPromises()
    expect(store.skill.detail).toMatchObject({
      name: 'demo',
      description: 'demo description',
      whenToUse: '需要时',
      modelInvocable: true,
      userInvocable: false,
      content: '# demo',
      local: true,
      contentLoading: false,
    })
  })

  it('本地未安装时仅保留摘要并结束加载', async () => {
    vi.mocked(getSkill).mockResolvedValue({ error: 'SKILL_NOT_FOUND: demo' })
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })

    openSkillDetail(SUMMARY)
    await flushPromises()

    expect(store.skill.detail).toMatchObject({ name: 'demo', description: 'demo description', local: false, content: '', contentLoading: false })
  })

  it('详情已关闭时迟到的响应不再写回', async () => {
    let finish!: (value: { name: string, content: string }) => void
    vi.mocked(getSkill).mockReturnValue(new Promise(resolve => (finish = resolve)))
    vi.mocked(getSkills).mockResolvedValue({ skills: [LOCAL_ROW] })

    openSkillDetail(SUMMARY)
    closeSkillDetail()
    finish({ name: 'demo', content: '# demo' })
    await flushPromises()

    expect(store.skill.detail).toBeNull()
  })
})
