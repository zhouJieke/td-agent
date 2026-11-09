import type { EmployeeDeptVO, EmployeeProfile, SkillPage, UserSkillDetails } from '../types'
import { invoke } from 'dsh-tauri/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteSkill, getInstalledSkills, getLocalSkill, getSkills } from '../apis'
import { store } from '../store'
import { fetchAuth } from './auth'
import { deleteLocalSkill } from './local-skills'
import { fetchCatalogSkills, fetchCommonSkills, fetchEmployees, fetchUserProfile, fetchUserSkills, saveUserSkills, uploadSkillZip } from './remote'
import { downloadSkill, fetchInstalledSkills, fetchSkillHub, loadSkillHub, saveUserSkillNames, selectManageUser, uploadMySkill } from './skill'

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
  getSkills: vi.fn(),
}))

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
  vi.mocked(getInstalledSkills).mockResolvedValue({ names: [] })
  vi.mocked(getSkills).mockReset()
  vi.mocked(deleteSkill).mockReset()
})

describe('登录态编排', () => {
  it('未登录时止步，不拉取技能数据', async () => {
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

  it('已登录时继续拉取技能数据', async () => {
    vi.mocked(fetchAuth).mockImplementation(async () => {
      store.skill.setEmployee({ employeeNumber: 'E10001', employeeName: '张三' })
      return true
    })
    vi.mocked(fetchCommonSkills).mockResolvedValue(page(['a']))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page(['a', 'b']))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['a']))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockResolvedValue(EMPLOYEES)
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['a'] })

    await loadSkillHub()

    expect(vi.mocked(fetchCommonSkills)).toHaveBeenCalledTimes(1)
    expect(store.skill.common).toHaveLength(1)
    expect(store.skill.catalog).toHaveLength(2)
    expect(getInstalledSkills).toHaveBeenCalledExactlyOnceWith({ timeout: 6_500 })
    expect(store.skill.installedNames).toEqual(['a'])
  })

  it('已登录的本地技能页只检查登录态，不请求企业技能接口', async () => {
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

describe('技能数据装配', () => {
  it('并发拉取技能数据、档案与员工列表并落库，配置对象默认当前用户', async () => {
    vi.mocked(fetchCommonSkills).mockResolvedValue(page(['a']))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page(['a', 'b']))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', ['a']))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockResolvedValue(EMPLOYEES)

    await fetchSkillHub('E10001')

    expect(store.skill.common.map(item => item.name)).toEqual(['a'])
    expect(store.skill.catalog.map(item => item.name)).toEqual(['a', 'b'])
    expect(store.skill.mine?.skillNames).toEqual(['a'])
    expect(store.skill.profile?.employeeName).toBe('张三')
    expect(store.skill.employees).toHaveLength(2)
    expect(store.skill.manageUserId).toBe('E10001')
    expect(store.skill.manageMine?.skillNames).toEqual(['a'])
    expect(store.skill.error).toBe('')
  })

  it('档案与员工列表失败不阻断其余数据', async () => {
    vi.mocked(fetchCommonSkills).mockResolvedValue(page(['a']))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page([]))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', []))
    vi.mocked(fetchUserProfile).mockRejectedValue(new Error('未找到员工档案'))
    vi.mocked(fetchEmployees).mockRejectedValue(new Error('employees unavailable'))

    await fetchSkillHub('E10001')

    expect(store.skill.profile).toBeNull()
    expect(store.skill.employees).toEqual([])
    expect(store.skill.common).toHaveLength(1)
    expect(store.skill.error).toBe('')
  })

  it('主数据失败落错误信息', async () => {
    vi.mocked(fetchCommonSkills).mockRejectedValue(new Error('技能服务未启用'))
    vi.mocked(fetchCatalogSkills).mockResolvedValue(page([]))
    vi.mocked(fetchUserSkills).mockResolvedValue(mine('E10001', []))
    vi.mocked(fetchUserProfile).mockResolvedValue(PROFILE)
    vi.mocked(fetchEmployees).mockResolvedValue([])

    await fetchSkillHub('E10001')

    expect(store.skill.error).toBe('技能服务未启用')
    expect(store.skill.loading).toBe(false)
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
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo-skill'] })

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
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo'] })

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
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo'] })

    await expect(downloadSkill('demo')).resolves.toEqual({ ok: true })

    expect(store.skill.feedback).toMatchObject({ kind: 'downloaded', skillName: 'demo', status: 'shadowed' })
  })

  it('安装完成后无法确认内核状态时保留文件并显示错误详情', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(getLocalSkill).mockRejectedValue(new Error('kernel unavailable'))
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo'] })
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
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo'] })
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
    let finishOld!: (result: { names: string[] }) => void
    vi.mocked(getInstalledSkills)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ names: ['demo'] })
    vi.mocked(invoke).mockResolvedValue(undefined)

    const oldRequest = fetchInstalledSkills()
    await downloadSkill('demo')
    finishOld({ names: [] })
    await oldRequest

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(store.skill.installedLoading).toBe(false)
  })

  it('原生安装发现同名技能时重新读取本地状态', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('SKILL_ALREADY_EXISTS: demo'))
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo'] })

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

  it('较早的查询失败不能覆盖较新的成功结果', async () => {
    let failOld!: (error: Error) => void
    vi.mocked(getInstalledSkills)
      .mockReturnValueOnce(new Promise((_, reject) => { failOld = reject }))
      .mockResolvedValueOnce({ names: ['demo'] })

    const oldRequest = fetchInstalledSkills()
    await fetchInstalledSkills()
    failOld(new Error('old failure'))
    await oldRequest

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(store.skill.installedChecked).toBe(true)
    expect(store.skill.installedError).toBe('')
  })

  it('删除成功后重新读取磁盘，旧查询不能恢复已删除状态', async () => {
    let finishOld!: (result: { names: string[] }) => void
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])
    store.localSkills.setConfirmName('demo')
    vi.mocked(deleteSkill).mockResolvedValue({ ok: true })
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    vi.mocked(getInstalledSkills)
      .mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ names: [] })

    const oldRequest = fetchInstalledSkills()
    await deleteLocalSkill()
    finishOld({ names: ['demo'] })
    await oldRequest

    expect(store.skill.installedNames).toEqual([])
    expect(store.skill.installedChecked).toBe(true)
  })

  it('删除了其他同名来源但目标目录仍存在时保留已安装状态', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])
    store.localSkills.setConfirmName('demo')
    vi.mocked(deleteSkill).mockResolvedValue({ ok: true })
    vi.mocked(getSkills).mockResolvedValue({ skills: [] })
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: ['demo'] })

    await deleteLocalSkill()

    expect(store.skill.installedNames).toEqual(['demo'])
    expect(getInstalledSkills).toHaveBeenCalledExactlyOnceWith({ timeout: 6_500 })
  })

  it('删除接口在移除文件后报错时仍重新检查本地状态', async () => {
    store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), ['demo'])
    store.localSkills.setConfirmName('demo')
    vi.mocked(deleteSkill).mockRejectedValue(new Error('provider refresh failed'))
    vi.mocked(getInstalledSkills).mockResolvedValue({ names: [] })

    await deleteLocalSkill()

    expect(store.localSkills.formError).toBe('provider refresh failed')
    expect(store.skill.installedNames).toEqual([])
  })
})
