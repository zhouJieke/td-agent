import type { EmployeeInfo } from 'dsh-tauri/client'
import type { GetApiTauriSkillHubLocalSkillResponse } from '../../apis/index.type'
import type { EmployeeDeptVO, EmployeeProfile, SkillSummary, SkillTab, UserSkillDetails } from '../../types'

export type SkillInstallStatus = Extract<GetApiTauriSkillHubLocalSkillResponse, { status: string }>['status']

export interface SkillSavedFeedback {
  seq: number
  kind: 'saved'
  name: string
  count: number
}

export interface SkillUploadedFeedback {
  seq: number
  kind: 'uploaded'
  skillName: string
  version: string
}

export interface SkillDownloadedFeedback {
  seq: number
  kind: 'downloaded' | 'updated'
  skillName: string
  status: SkillInstallStatus
  detail?: string
}

export interface SkillFailedFeedback {
  seq: number
  kind: 'failed'
  error: string
}

/** 一次用户可感知的操作结果，由 Toast 呈现（kind → 文案在面板里查词典）。 */
export type SkillFeedback = SkillSavedFeedback | SkillUploadedFeedback | SkillDownloadedFeedback | SkillFailedFeedback

/** 只读详情弹窗数据：远端摘要先行展示，本地正文加载完成后补齐。 */
export interface SkillDetailState {
  name: string
  description: string
  whenToUse: string
  modelInvocable: boolean
  userInvocable: boolean
  content: string
  local: boolean
  contentLoading: boolean
}

/** 面板可变状态：三份接口数据是唯一真值，页签与检索词是视图状态。 */
export interface SkillHubState {
  /** 登录态探测结果；`null` 表示未登录（或尚未探测完成）。 */
  employee: EmployeeInfo | null
  /** 登录态探测是否已完成；未完成时不渲染未登录提示。 */
  authChecked: boolean
  authRequestId: number
  /** 企业公用技能（`/api/employee-skills/common`）。 */
  common: readonly SkillSummary[]
  /** 全量技能（`/api/employee-skills`），作为管理页的配置候选。 */
  catalog: readonly SkillSummary[]
  /** 当前用户已配置的技能详情（`/api/employee-skills/user/{工号}`）。 */
  mine: UserSkillDetails | null
  /** 当前用户的姓名与部门（`/user/{工号}/profile`）；档案不存在时为 `null`。 */
  profile: EmployeeProfile | null
  /** 全量员工（接口 6），作为管理页的配置对象下拉。 */
  employees: readonly EmployeeDeptVO[]
  /** 管理页当前被配置技能的员工工号。 */
  manageUserId: string
  /** 管理页目标员工已配置的技能详情。 */
  manageMine: UserSkillDetails | null
  /** 管理页目标员工数据加载中。 */
  manageLoading: boolean
  tab: SkillTab
  keyword: string
  loading: boolean
  downloading: readonly string[]
  installedNames: readonly string[]
  installedVersions: Readonly<Record<string, string>>
  updatableNames: readonly string[]
  installedChecked: boolean
  installedLoading: boolean
  installedRequestId: number
  installedError: string
  error: string
  feedback: SkillFeedback | null
  feedbackSeq: number
  /** 企业/我的技能只读详情；`null` 表示弹窗关闭。 */
  detail: SkillDetailState | null
}
