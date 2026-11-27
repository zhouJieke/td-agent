import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Card, Tag } from 'dsh-tauri-ui/client'
import { parseBizTags } from '../store/modules/skill.utils'
import { SkillIcon } from './skill-icon'

interface SkillCardProps {
  t: Translate
  skill: SkillSummary
  actions?: ReactNode
  onSelect?: (skill: SkillSummary) => void
}

export function SkillCard({ t, skill, actions, onSelect }: SkillCardProps): ReactElement {
  const tags = parseBizTags(skill.bizTags)
  const activate = (): void => onSelect?.(skill)
  const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }
  const interaction = onSelect === undefined
    ? {}
    : {
        role: 'button' as const,
        tabIndex: 0,
        title: t('viewSkill'),
        onClick: (event: MouseEvent<HTMLLIElement>) => {
          if (event.target instanceof Element && event.target.closest('button, a, input, label') !== null)
            return
          activate()
        },
        onKeyDown: handleKeyDown,
      }

  return (
    <Card
      variant={onSelect === undefined ? 'default' : 'link'}
      className="mx-0 flex flex-col gap-[10px] rounded-[18px] border border-border-l2 bg-layer-3 px-[16px] py-[12px] transition-colors focus-visible:shadow-focus-ring focus-visible:outline-none"
      {...interaction}
    >
      <div className="flex items-start gap-[14px]">
        <SkillIcon name={skill.name} />
        <Card.Content className="gap-[6px]">
          <Card.Title className="text-[15px] leading-[22px]" title={skill.name}>
            {skill.name}
          </Card.Title>
          <Card.Description className="text-secondary leading-[20px]" title={skill.description ?? undefined}>
            {skill.description ?? t('skill.noDescription')}
          </Card.Description>
        </Card.Content>
        {actions === undefined ? null : <Card.End>{actions}</Card.End>}
      </div>
      {tags.length === 0
        ? null
        : (
            <div className="mt-auto flex flex-wrap items-center gap-[6px]">
              {tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
            </div>
          )}
    </Card>
  )
}
