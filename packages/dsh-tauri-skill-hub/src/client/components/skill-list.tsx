import type { ReactElement, ReactNode } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Card } from 'dsh-tauri-ui/client'
import { sortSummaries } from '../store/modules/skill.utils'
import { SkillCard } from './skill-card'

interface SkillListProps {
  t: Translate
  skills: SkillSummary[]
  emptyText: string
  /** 每张卡片行尾的操作区，通常是安装按钮。 */
  actions?: (skill: SkillSummary) => ReactNode
  /** 卡片点击回调；传入后卡片可打开只读详情。 */
  onSelect?: (skill: SkillSummary) => void
}

/** 技能摘要列表；企业公用技能与我的技能共用。 */
export function SkillList({ t, skills, emptyText, actions, onSelect }: SkillListProps): ReactElement {
  if (skills.length === 0)
    return <div className="text-tertiary text-[12px]">{emptyText}</div>

  return (
    <Card.List className="grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-[12px]">
      {sortSummaries(skills).map(skill => (
        <SkillCard
          key={`${skill.namespaceId}/${skill.name}`}
          t={t}
          skill={skill}
          actions={actions?.(skill)}
          onSelect={onSelect}
        />
      ))}
    </Card.List>
  )
}
