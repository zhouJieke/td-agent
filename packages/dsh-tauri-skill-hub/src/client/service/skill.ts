import type { SkillInstallStatus } from '../store/modules/skill.types'
import type { ActionResult, SkillSummary, SkillTab } from '../types'
import { invoke } from 'dsh-tauri/client'
import { getInstalledSkills, getLocalSkill, getSkill, getSkills, postSkillsRefresh } from '../apis'
import { store } from '../store'
import { employeeLabel, findEmployee, installedSkillVersion, isNewerSkillVersion, isSkillVersion } from '../store/modules/skill.utils'
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
 * Query：面板装配总入口。已登录时不再重复探测登录态，只按当前页签拉取该页所需的接口，
 * 已加载过的页签直接复用 store 中的数据，切换页签时列表不会重新刷新。
 */
export async function loadSkillHub(): Promise<void> {
  if (store.skill.employee === null || !store.skill.authChecked) {
    if (!await fetchAuth())
      return
    store.skill.resetLoadedTabs()
  }
  const employee = store.skill.employee
  if (employee === null || store.skill.tab === 'local')
    return
  await Promise.all([fetchSkillTab(employee.employeeNumber, store.skill.tab), fetchInstalledSkills()])
}

export async function fetchInstalledSkills(): Promise<void> {
  const requestId = store.skill.startInstalledLoad()
  try {
    const result = await getInstalledSkills({ timeout: 6_500 })
    if ('error' in result)
      throw new Error(result.error)
    if (!Array.isArray(result.names) || result.names.some(name => typeof name !== 'string')
      || typeof result.versions !== 'object' || result.versions === null || Array.isArray(result.versions)
      || Object.entries(result.versions).some(([name, version]) => !result.names.includes(name) || !isSkillVersion(version))
      || !Array.isArray(result.updatableNames) || result.updatableNames.some(name => typeof name !== 'string' || !result.names.includes(name))
      || Object.keys(result.versions).some(name => !result.updatableNames.includes(name))) {
      throw new Error('SKILL_INSTALLED_STATUS_INVALID')
    }
    store.skill.finishInstalledLoad(requestId, result.names, result.versions, result.updatableNames)
  }
  catch (error) {
    store.skill.failInstalledLoad(requestId, messageOf(error))
  }
}

/**
 * Query：按页签拉取该页所需的最小接口集合。
 * 企业页只要公用技能，我的技能页只要个人名单与档案，管理页才需要全量目录与员工列表。
 * 传输层错误落 `store.skill.error` 由面板内联渲染；员工与档案失败降级为空值不阻断。
 */
export async function fetchSkillTab(userId: string, tab: SkillTab, force = false): Promise<void> {
  if (!force && store.skill.loadedTabs.includes(tab))
    return
  const authRequestId = store.skill.authRequestId
  try {
    if (tab === 'enterprise') {
      const common = await fetchCommonSkills()
      if (isStale(authRequestId, userId))
        return
      store.skill.setCommon(common.items)
    }
    else if (tab === 'mine') {
      const [mine, profile] = await Promise.all([
        fetchUserSkills(userId),
        fetchUserProfile(userId).catch(() => null),
      ])
      if (isStale(authRequestId, userId))
        return
      store.skill.setMine(mine)
      store.skill.setProfile(profile)
      if (store.skill.manageUserId === userId)
        store.skill.setManageMine(mine)
    }
    else if (tab === 'manage') {
      const [catalog, employees, mine, profile] = await Promise.all([
        fetchCatalogSkills(),
        fetchEmployees().catch(() => []),
        fetchUserSkills(userId),
        fetchUserProfile(userId).catch(() => null),
      ])
      if (isStale(authRequestId, userId))
        return
      store.skill.setCatalog(catalog.items)
      store.skill.setEmployees(employees)
      store.skill.setMine(mine)
      store.skill.setProfile(profile)
      store.skill.setManageUser(userId)
      store.skill.setManageMine(mine)
    }
    else {
      return
    }
    store.skill.setError('')
    store.skill.markTabLoaded(tab)
  }
  catch (error) {
    if (isStale(authRequestId, userId))
      return
    store.skill.setError(messageOf(error))
  }
}

function isStale(authRequestId: number, userId: string): boolean {
  return store.skill.authRequestId !== authRequestId || store.skill.employee?.employeeNumber !== userId
}

/**
 * Query：点击企业/我的技能卡片打开只读详情。
 * 先以远端摘要上屏，再异步补齐本地已安装的正文与元数据；本地未安装则只展示摘要。
 */
export function openSkillDetail(summary: SkillSummary): void {
  store.skill.setDetail({
    name: summary.name,
    description: summary.description ?? '',
    whenToUse: '',
    modelInvocable: false,
    userInvocable: false,
    content: '',
    local: false,
    contentLoading: true,
    latestVersion: summary.labels.latest,
  })
  void loadSkillDetail(summary)
}

export function closeSkillDetail(): void {
  store.skill.setDetail(null)
}

async function loadSkillDetail(summary: SkillSummary): Promise<void> {
  try {
    const [contentResult, skillsResult] = await Promise.all([
      getSkill({ name: summary.name }),
      getSkills(),
    ])
    if (!isDetailLoading(summary.name))
      return
    if ('error' in contentResult)
      throw new Error(contentResult.error)
    const row = 'skills' in skillsResult ? skillsResult.skills.find(item => item.name === summary.name) : undefined
    store.skill.setDetail({
      name: summary.name,
      description: summary.description ?? row?.description ?? '',
      whenToUse: row?.whenToUse ?? '',
      modelInvocable: row?.invocation.modelInvocable ?? false,
      userInvocable: row?.invocation.userInvocable ?? false,
      content: contentResult.content,
      local: true,
      contentLoading: false,
      latestVersion: summary.labels.latest,
    })
  }
  catch {
    if (!isDetailLoading(summary.name))
      return
    const current = store.skill.detail
    if (current !== null)
      store.skill.setDetail({ ...current, contentLoading: false })
  }
}

function isDetailLoading(name: string): boolean {
  const detail = store.skill.detail
  return detail !== null && detail.name === name && detail.contentLoading
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
  if (store.skill.installedNames.includes(name))
    return fail(new Error(`SKILL_ALREADY_EXISTS: ${name}`))
  store.skill.startDownload(name)
  try {
    await invoke<void>('desktop_install_employee_skill', { skillName: name }, { timeoutMs: 90_000 })
    store.skill.markInstalled(name)
    const installedRefresh = fetchInstalledSkills()
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
    await installedRefresh
    return { ok: true }
  }
  catch (error) {
    const result = fail(error)
    await fetchInstalledSkills()
    return result
  }
  finally {
    store.skill.finishDownload(name)
  }
}

export async function updateSkill({ name, latestVersion, installedVersion }: {
  name: string
  latestVersion: string
  installedVersion: string | null
}): Promise<ActionResult> {
  if (store.skill.downloading.includes(name))
    return fail(new Error('SKILL_DOWNLOAD_IN_PROGRESS'))
  if (!store.skill.installedChecked || store.skill.installedLoading || store.skill.installedError !== ''
    || !store.skill.installedNames.includes(name) || !store.skill.updatableNames.includes(name)) {
    return fail(new Error('SKILL_UPDATE_UNAVAILABLE'))
  }
  if ((installedSkillVersion(store.skill.installedVersions, name) ?? null) !== installedVersion)
    return fail(new Error('SKILL_VERSION_CHANGED'))
  if (!isSkillVersion(latestVersion) || (installedVersion !== null && !isNewerSkillVersion(latestVersion, installedVersion)))
    return fail(new Error('SKILL_VERSION_INVALID'))
  store.skill.startDownload(name)
  try {
    const version = await invoke<string>('desktop_update_employee_skill', {
      skillName: name,
      expectedVersion: latestVersion,
      installedVersion,
    }, { timeoutMs: 90_000 })
    if (version !== latestVersion)
      throw new Error('SKILL_UPDATE_RESULT_INVALID')
    store.skill.markInstalled(name, version)
    const installedRefresh = fetchInstalledSkills()
    try {
      const refreshed = await postSkillsRefresh()
      if ('error' in refreshed)
        throw new Error(refreshed.error)
      const result = await getLocalSkill({ name }, { timeout: 6_500 })
      if ('error' in result)
        throw new Error(result.error)
      if (!INSTALL_STATUSES.includes(result.status))
        throw new Error('SKILL_STATUS_INVALID')
      store.skill.notifyUpdated(name, result.status)
    }
    catch (error) {
      console.error('[skill-hub] Failed to verify updated skill:', error)
      store.skill.notifyUpdated(name, 'unavailable', messageOf(error))
    }
    await installedRefresh
    return { ok: true }
  }
  catch (error) {
    if (messageOf(error).split(':', 1)[0] === 'SKILL_REMOTE_VERSION_CHANGED') {
      const userId = store.skill.employee?.employeeNumber
      if (typeof userId === 'string' && userId.trim() !== '')
        await fetchSkillTab(userId, store.skill.tab, true)
    }
    const result = fail(error)
    await fetchInstalledSkills()
    return result
  }
  finally {
    store.skill.finishDownload(name)
  }
}
