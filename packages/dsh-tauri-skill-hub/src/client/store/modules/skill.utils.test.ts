import type { EmployeeDeptVO, SkillSummary } from '../../types'
import { describe, expect, it } from 'vitest'
import { employeeLabel, filterSummaries, findEmployee, parseBizTags, skillTitle, sortSummaries, toTab } from './skill.utils'

const DAY_MS = 86_400_000
const NOW = Date.parse('2026-10-20T12:00:00Z')

function summary(name: string, changes: Partial<SkillSummary> = {}): SkillSummary {
  return {
    namespaceId: 'ns',
    name,
    description: `${name} description`,
    updateTime: NOW,
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
    ...changes,
  }
}

describe('bizTags 解析', () => {
  it('解析 JSON 数组字符串，只保留字符串项', () => {
    expect(parseBizTags('["企业公用技能","研发"]')).toEqual(['企业公用技能', '研发'])
    expect(parseBizTags('[1,"a"]')).toEqual(['a'])
  })

  it('非法 JSON、非数组与 null 一律返回空数组', () => {
    expect(parseBizTags('not json')).toEqual([])
    expect(parseBizTags('{"a":1}')).toEqual([])
    expect(parseBizTags(null)).toEqual([])
  })
})

describe('技能检索与排序', () => {
  it('关键词命中名称、描述与业务标签，空关键词原样返回', () => {
    const skills = [
      summary('code-review', { description: '代码评审助手' }),
      summary('sql-optimizer', { description: '解析执行计划', bizTags: '["数据"]' }),
    ]
    expect(filterSummaries(skills, '').map(item => item.name)).toEqual(['code-review', 'sql-optimizer'])
    expect(filterSummaries(skills, 'CODE').map(item => item.name)).toEqual(['code-review'])
    expect(filterSummaries(skills, '评审').map(item => item.name)).toEqual(['code-review'])
    expect(filterSummaries(skills, '数据').map(item => item.name)).toEqual(['sql-optimizer'])
    expect(filterSummaries(skills, '执行计划').map(item => item.name)).toEqual(['sql-optimizer'])
    expect(filterSummaries(skills, '不存在')).toEqual([])
  })

  it('按更新时间倒序排列，缺失时间戳排最后，且不改动入参数组', () => {
    const input = [
      summary('old', { updateTime: NOW - 2 * DAY_MS }),
      summary('none', { updateTime: null }),
      summary('new', { updateTime: NOW }),
      summary('mid', { updateTime: NOW - DAY_MS }),
    ]
    const frozen = Object.freeze([...input])
    expect(sortSummaries(frozen).map(item => item.name)).toEqual(['new', 'mid', 'old', 'none'])
    expect(frozen.map(item => item.name)).toEqual(['old', 'none', 'new', 'mid'])
  })
})

describe('展示名与页签取值', () => {
  it('展示名优先用描述，描述为空退回技能名', () => {
    expect(skillTitle(summary('a', { description: '代码评审' }))).toBe('代码评审')
    expect(skillTitle(summary('b', { description: null }))).toBe('b')
    expect(skillTitle(summary('c', { description: '' }))).toBe('c')
  })

  it('未知页签退回企业目录', () => {
    expect(toTab('mine')).toBe('enterprise')
    expect(toTab('manage')).toBe('manage')
    expect(toTab('local')).toBe('local')
    expect(toTab('unknown')).toBe('enterprise')
  })
})

describe('员工查找与展示名', () => {
  const EMPLOYEES: EmployeeDeptVO[] = [
    { userId: 'E10001', employeeName: '张三', departmentName: '技术部' },
    { userId: 'E10002', employeeName: null, departmentName: null },
  ]

  it('按工号查找员工，查不到返回 undefined', () => {
    expect(findEmployee(EMPLOYEES, 'E10001')?.employeeName).toBe('张三')
    expect(findEmployee(EMPLOYEES, 'E404')).toBeUndefined()
  })

  it('展示名优先「姓名 · 部门」，缺字段时退化，查不到时退回入参', () => {
    expect(employeeLabel(findEmployee(EMPLOYEES, 'E10001'), 'fallback')).toBe('张三 · 技术部')
    expect(employeeLabel(findEmployee(EMPLOYEES, 'E10002'), 'E10002')).toBe('E10002')
    expect(employeeLabel(findEmployee(EMPLOYEES, 'E404'), 'E404')).toBe('E404')
  })
})
