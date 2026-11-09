import type { GetApiTauriSkillHubSkillsResponse } from '../apis/index.type'
import type { SKILL_TABS } from '../constants'

/** 面板页签标识。 */
export type SkillTab = typeof SKILL_TABS[number]

export type SkillRowView = Extract<GetApiTauriSkillHubSkillsResponse, { skills: unknown }>['skills'][number]

/** 技能概要（接口文档 0.5 节 SkillSummary）。 */
export interface SkillSummary {
  namespaceId: string
  name: string
  description: string | null
  updateTime: number | null
  owner: string | null
  enable: boolean
  /** JSON 数组字符串原值，前端需自行解析。 */
  bizTags: string | null
  from: string | null
  scope: string | null
  labels: Record<string, string>
  editingVersion: string | null
  reviewingVersion: string | null
  onlineCnt: number | null
  downloadCount: number | null
}

/** 单个版本摘要。 */
export interface SkillVersion {
  version: string
  status: string
  author: string | null
  commitMsg: string | null
  createTime: number | null
  updateTime: number | null
  publishPipelineInfo: string | null
  downloadCount: number | null
}

/** 单个技能的完整治理视图。 */
export interface SkillDetail {
  summary: SkillSummary
  versions: readonly SkillVersion[]
}

/** 取详情失败的技能。 */
export interface FailedSkill {
  name: string
  reason: string
}

/** 按 userId 查技能详情的响应。 */
export interface UserSkillDetails {
  userId: string
  skillNames: readonly string[]
  skills: readonly SkillDetail[]
  failed: readonly FailedSkill[]
}

/** 分页对象。 */
export interface SkillPage {
  totalCount: number
  pageNumber: number
  pagesAvailable: number
  items: readonly SkillSummary[]
}

/** 员工姓名与部门。 */
export interface EmployeeProfile {
  userId: string
  employeeName: string | null
  departmentName: string | null
}

/** 全量员工条目（接口 6 的 `EmployeeDeptVO`）。 */
export interface EmployeeDeptVO {
  userId: string
  employeeName: string | null
  departmentName: string | null
}

/** 本地技能上传成功回执。 */
export interface UploadedSkill {
  skillName: string
  version: string
}

/** Action 的统一返回面。 */
export interface ActionResult {
  ok: boolean
  error?: string
}
