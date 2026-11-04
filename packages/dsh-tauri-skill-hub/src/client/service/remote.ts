import type { EmployeeDeptVO, EmployeeProfile, SkillPage, UserSkillDetails } from '../types'
import { invoke } from 'dsh-tauri/client'
import { PAGE_SIZE, SKILL_API_BASE } from '../constants'

/**
 * service/remote.ts — 传输层：技能数据经宿主同源代理转发
 * `SKILL_API_BASE`（/api）的 `/employee-skills/**`。
 *
 * 鉴权：业务请求统一走 `desktop_auth_request`，由 Rust 侧自动携带 Bearer 并处理续期；
 * 未登录或会话失效时命令会抛错，错误交由上层展示。
 *
 * 业务信封固定为 `{ code, msg, data }`：`code === 0` 才读 `data`，
 * 否则把 `msg` 抛成 Error 交给上层展示。参数错误不返回 400，
 * 而是 HTTP 200 + `code=1` + 具体 `msg`。
 */

interface Envelope<T> {
  code: number
  msg: string | null
  data: T | null
}

interface SkillPageQuery {
  pageNo: number
  pageSize: number
}

let authApiBasePromise: Promise<string> | null = null

function authApiBase(): Promise<string> {
  if (authApiBasePromise === null) {
    authApiBasePromise = invoke<string>('desktop_auth_api_base')
      .then(base => base.replace(/\/+$/, ''))
      .catch(() => '')
  }
  return authApiBasePromise
}

async function call<T>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> {
  const url = `${SKILL_API_BASE}${path}`
  const base = await authApiBase()
  const absoluteUrl = base.length > 0 ? `${base}${url}` : url
  console.warn(`[skill-hub] request ${method.toUpperCase()} ${absoluteUrl}`)
  let envelope: Envelope<T>
  try {
    envelope = await invoke<Envelope<T>>('desktop_auth_request', {
      method: method.toUpperCase(),
      path: url,
      body: body ?? null,
    })
  }
  catch (error) {
    console.warn(`[skill-hub] response ${method.toUpperCase()} ${absoluteUrl} failed`, error)
    throw error
  }
  console.warn(`[skill-hub] response ${method.toUpperCase()} ${absoluteUrl}`, envelope)
  if (envelope.code !== 0)
    throw new Error(envelope.msg ?? 'SKILL_REQUEST_FAILED')
  return envelope.data as T
}

function pageQuery({ pageNo, pageSize }: SkillPageQuery): string {
  return `?pageNo=${pageNo}&pageSize=${pageSize}`
}

async function fetchAllPages(path: '/employee-skills' | '/employee-skills/common'): Promise<SkillPage> {
  const first = await call<SkillPage>('get', `${path}${pageQuery({ pageNo: 1, pageSize: PAGE_SIZE })}`)
  const last = Math.max(1, first.pagesAvailable)
  if (last === 1)
    return first
  const rest = await Promise.all(
    Array.from({ length: last - 1 }, (_, index) => call<SkillPage>('get', `${path}${pageQuery({ pageNo: index + 2, pageSize: PAGE_SIZE })}`)),
  )
  return {
    ...first,
    pageNumber: 1,
    pagesAvailable: last,
    items: [first.items, ...rest.map(item => item.items)].flat(),
  }
}

/** 接口 3：企业公用技能列表（分页拉全量）。 */
export function fetchCommonSkills(): Promise<SkillPage> {
  return fetchAllPages('/employee-skills/common')
}

/** 接口 2：全量技能列表（分页拉全量），作为管理页的配置候选。 */
export function fetchCatalogSkills(): Promise<SkillPage> {
  return fetchAllPages('/employee-skills')
}

/** 接口 1：按工号查该人员已配置的技能详情。 */
export function fetchUserSkills(userId: string): Promise<UserSkillDetails> {
  return call<UserSkillDetails>('get', `/employee-skills/user/${encodeURIComponent(userId)}`)
}

/** 接口 4：按工号查员工姓名与部门。 */
export function fetchUserProfile(userId: string): Promise<EmployeeProfile> {
  return call<EmployeeProfile>('get', `/employee-skills/user/${encodeURIComponent(userId)}/profile`)
}

/** 接口 5：整份覆盖某工号的技能名单。 */
export function saveUserSkills(userId: string, skillNames: readonly string[]): Promise<boolean> {
  return call<boolean>('post', `/employee-skills/user/${encodeURIComponent(userId)}`, { skillNames })
}

/** 接口 6：全量员工姓名与部门（一次返回，不分页；只取在职员工）。 */
export function fetchEmployees(): Promise<EmployeeDeptVO[]> {
  return call<EmployeeDeptVO[]>('get', '/employee-skills/employees')
}
