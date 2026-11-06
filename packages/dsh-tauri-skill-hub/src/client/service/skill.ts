import type { SkillInstallStatus } from '../store/modules/skill.types'
import type { ActionResult } from '../types'
import { invoke } from 'dsh-tauri/client'
import { getLocalSkill } from '../apis'
import { store } from '../store'
import { employeeLabel, findEmployee } from '../store/modules/skill.utils'
import { fetchAuth } from './auth'
import { fetchCatalogSkills, fetchCommonSkills, fetchEmployees, fetchUserProfile, fetchUserSkills, saveUserSkills, uploadSkillZip } from './remote'

const INSTALL_STATUSES: readonly SkillInstallStatus[] = ['ready', 'pending', 'shadowed', 'not-invocable', 'unavailable']

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(error: unknown): ActionResult {
  const message = messageOf(error)
  store.skill.notifyFailed(message)
  return { ok: false, error: message }
}

/**
 * Query：面板装配总入口。先探测登录态，未登录止步（面板渲染登录提示）；
 * 已登录再并发拉取技能数据、当前用户档案与全量员工列表。
 */
export async function loadSkillHub(): Promise<void> {
  await fetchAuth()
  const employee = store.skill.employee
  if (employee === null)
    return
  await fetchSkillHub(employee.employeeNumber)
}

/**
 * Query：并发拉取企业公用技能、全量技能、当前用户已配置技能、用户档案与员工列表。
 * 员工列表失败不阻断其余数据（管理页下拉退化为仅当前用户）。
 * 传输层错误落 `store.skill.error` 由面板内联渲染。
 */
export async function fetchSkillHub(userId: string): Promise<void> {
  store.skill.setLoading(true)
  try {
    const [common, catalog, mine, profile, employees] = await Promise.all([
      fetchCommonSkills(),
      fetchCatalogSkills(),
      fetchUserSkills(userId),
      fetchUserProfile(userId).catch(() => null),
      fetchEmployees().catch(() => []),
    ])
    store.skill.setCommon(common.items)
    store.skill.setCatalog(catalog.items)
    store.skill.setMine(mine)
    store.skill.setProfile(profile)
    store.skill.setEmployees(employees)
    store.skill.setManageUser(userId)
    store.skill.setManageMine(mine)
    store.skill.setError('')
  }
  catch (error) {
    store.skill.setError(messageOf(error))
  }
}

/** Query：切换管理页的配置对象，拉取该员工已配置的技能名单。 */
export async function selectManageUser(userId: string): Promise<void> {
  if (userId === store.skill.manageUserId)
    return
  store.skill.setManageUser(userId)
  store.skill.setManageLoading(true)
  try {
    store.skill.setManageMine(await fetchUserSkills(userId))
  }
  catch (error) {
    store.skill.setManageMine(null)
    store.skill.notifyFailed(messageOf(error))
  }
  finally {
    store.skill.setManageLoading(false)
  }
}

/** Action：整份覆盖某工号的技能名单（接口 5），保存后回拉最新名单。 */
export async function saveUserSkillNames(userId: string, skillNames: readonly string[]): Promise<ActionResult> {
  try {
    await saveUserSkills(userId, skillNames)
    const mine = await fetchUserSkills(userId)
    if (userId === store.skill.employee?.employeeNumber)
      store.skill.setMine(mine)
    store.skill.setManageMine(mine)
    const label = employeeLabel(findEmployee(store.skill.employees, userId), userId)
    store.skill.notifySaved(label, mine.skillNames.length)
    return { ok: true }
  }
  catch (error) {
    return fail(error)
  }
}

export async function uploadMySkill(file: File): Promise<ActionResult> {
  const userId = store.skill.employee?.employeeNumber
  if (typeof userId !== 'string' || userId.trim().length === 0)
    return fail(new Error('请先登录'))
  try {
    const uploaded = await uploadSkillZip(file)
    const [mine, catalog] = await Promise.all([
      fetchUserSkills(userId),
      fetchCatalogSkills(),
    ])
    store.skill.setMine(mine)
    if (userId === store.skill.manageUserId)
      store.skill.setManageMine(mine)
    store.skill.setCatalog(catalog.items)
    store.skill.notifyUploaded(uploaded.skillName, uploaded.version)
    return { ok: true }
  }
  catch (error) {
    return fail(error)
  }
}

export async function downloadSkill(name: string): Promise<ActionResult> {
  if (store.skill.downloading.includes(name))
    return fail(new Error('SKILL_DOWNLOAD_IN_PROGRESS'))
  store.skill.startDownload(name)
  try {
    await invoke<void>('desktop_install_employee_skill', { skillName: name }, { timeoutMs: 90_000 })
    try {
      const result = await getLocalSkill({ name }, { timeout: 6_500 })
      if ('error' in result)
        throw new Error(result.error)
      if (!INSTALL_STATUSES.includes(result.status))
        throw new Error('SKILL_STATUS_INVALID')
      store.skill.notifyDownloaded(name, result.status)
    }
    catch (error) {
      console.error('[skill-hub] Failed to verify installed skill:', error)
      store.skill.notifyDownloaded(name, 'unavailable', messageOf(error))
    }
    return { ok: true }
  }
  catch (error) {
    return fail(error)
  }
  finally {
    store.skill.finishDownload(name)
  }
}
