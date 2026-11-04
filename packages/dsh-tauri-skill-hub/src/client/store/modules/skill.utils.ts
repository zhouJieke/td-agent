import type { EmployeeDeptVO, SkillSummary, SkillTab } from '../../types'
import { filter, find, includes, isEmpty, lowerCase, orderBy } from 'dsh-tauri/client'
import { SKILL_TABS } from '../../constants'

const DAY_MS = 86_400_000

/** `bizTags` 是 JSON 数组字符串原值；解析失败或非字符串数组时返回空数组。 */
export function parseBizTags(raw: string | null): string[] {
  if (raw === null)
    return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed))
      return []
    return parsed.filter((item): item is string => typeof item === 'string')
  }
  catch {
    return []
  }
}

/** 名称、描述与业务标签的模糊匹配；空关键词原样返回。 */
export function filterSummaries(skills: readonly SkillSummary[], keyword: string): SkillSummary[] {
  if (isEmpty(keyword))
    return [...skills]
  const needle = lowerCase(keyword)
  return filter(skills, skill => includes(
    lowerCase(`${skill.name} ${skill.description ?? ''} ${parseBizTags(skill.bizTags).join(' ')}`),
    needle,
  ))
}

/** 统一按更新时间倒序；缺失时间戳排最后。 */
export function sortSummaries(skills: readonly SkillSummary[]): SkillSummary[] {
  return orderBy(skills, [skill => skill.updateTime ?? 0], ['desc'])
}

/** 技能展示名：有描述用描述，否则退回技能名。 */
export function skillTitle(skill: SkillSummary): string {
  return isEmpty(skill.description) ? skill.name : skill.description!
}

/** 按工号查找员工条目。 */
export function findEmployee(employees: readonly EmployeeDeptVO[], userId: string): EmployeeDeptVO | undefined {
  return find(employees, employee => employee.userId === userId)
}

/** 员工下拉的展示名：优先 `姓名 · 部门`，缺字段时退化。 */
export function employeeLabel(employee: EmployeeDeptVO | undefined, fallback: string): string {
  if (employee === undefined)
    return fallback
  const name = employee.employeeName?.trim() ?? ''
  const department = employee.departmentName?.trim() ?? ''
  if (!isEmpty(name) && !isEmpty(department))
    return `${name} · ${department}`
  if (!isEmpty(name))
    return name
  if (!isEmpty(department))
    return department
  return fallback
}

/** 距今整天数；同一天返回 0。 */
export function daysSince(timestamp: number, now: number): number {
  return Math.max(0, Math.floor((now - timestamp) / DAY_MS))
}

/** `SegmentedControl` 的字符串值收敛回页签联合类型。 */
export function toTab(value: string): SkillTab {
  return find(SKILL_TABS, tab => tab === value) ?? 'enterprise'
}
