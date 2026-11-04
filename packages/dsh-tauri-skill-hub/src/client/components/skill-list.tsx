import type { ReactElement, ReactNode } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Card, Text } from 'dsh-tauri-ui/client'
import { sortSummaries } from '../store/modules/skill.utils'
import { SkillCard } from './skill-card'

interface SkillListProps {
  t: Translate
  skills: readonly SkillSummary[]
  emptyText: string
  /** 行尾操作区；只读页面不传。 */
  actions?: (skill: SkillSummary) => ReactNode
}

export function SkillList({ t, skills, emptyText, actions }: SkillListProps): ReactElement {
  if (skills.length === 0)
    return <Text tone="tertiary" size="sm" className="py-[32px] text-center">{emptyText}</Text>

  return (
    <Card.List className="gap-[8px]">
      {sortSummaries(skills).map(skill => (
        <SkillCard
          key={`${skill.namespaceId}/${skill.name}`}
          t={t}
          skill={skill}
          actions={actions?.(skill)}
        />
      ))}
    </Card.List>
  )
}
