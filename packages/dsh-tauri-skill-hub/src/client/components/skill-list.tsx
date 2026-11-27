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
  actions?: (skill: SkillSummary) => ReactNode
  onSelect?: (skill: SkillSummary) => void
}

export function SkillList({ t, skills, emptyText, actions, onSelect }: SkillListProps): ReactElement {
  if (skills.length === 0)
    return <div className="text-tertiary text-[12px]">{emptyText}</div>

  return (
    <Card.List
      className="grid items-stretch gap-[16px]"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}
    >
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
