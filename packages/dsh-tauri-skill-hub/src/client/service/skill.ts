import type { ActionResult } from '../types'
import { store } from '../store'
import { employeeLabel, findEmployee } from '../store/modules/skill.utils'
import { fetchAuth } from './auth'
import { fetchCatalogSkills, fetchCommonSkills, fetchEmployees, fetchUserProfile, fetchUserSkills, saveUserSkills } from './remote'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fail(error: unknown): ActionResult {
  const message = messageOf(error)
  store.skill.notify('failed', '', 0, message)
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
    store.skill.notify('failed', '', 0, messageOf(error))
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
    store.skill.notify('saved', label, mine.skillNames.length)
    return { ok: true }
  }
  catch (error) {
    return fail(error)
  }
}
