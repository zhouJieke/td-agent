import type { EmployeeInfo } from 'dsh-tauri/client'
import type { EmployeeDeptVO, EmployeeProfile, SkillSummary, SkillTab, UserSkillDetails } from '../../types'

/** 一次用户可感知的操作结果，由 Toast 呈现（kind → 文案在面板里查词典）。 */
export type SkillFeedbackKind = 'saved' | 'failed'

export interface SkillFeedback {
  seq: number
  kind: SkillFeedbackKind
  /** 被配置用户的展示名。 */
  name: string
  /** 保存后的技能条数。 */
  count: number
  /** `failed` 的原始错误信息。 */
  error?: string
}

/** 面板可变状态：三份接口数据是唯一真值，页签与检索词是视图状态。 */
export interface SkillHubState {
  /** 登录态探测结果；`null` 表示未登录（或尚未探测完成）。 */
  employee: EmployeeInfo | null
  /** 登录态探测是否已完成；未完成时不渲染未登录提示。 */
  authChecked: boolean
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
  error: string
  feedback: SkillFeedback | null
  feedbackSeq: number
}
