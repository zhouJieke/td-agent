import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Card, GraduationCap, Icon, Tag } from 'dsh-tauri-ui/client'
import { parseBizTags } from '../store/modules/skill.utils'

interface SkillCardProps {
  t: Translate
  skill: SkillSummary
  /** 行尾操作区，由管理页传入；只读页面不传。 */
  actions?: ReactNode
  /** 传入后整卡可点击，打开只读详情弹窗。 */
  onSelect?: (skill: SkillSummary) => void
}

/** 技能摘要卡片：展示技能名称、简介与业务标签；整卡可点击时打开只读详情。 */
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
      className="flex flex-col gap-[6px] px-[14px] py-[12px]"
      {...interaction}
    >
      <div className="flex items-center gap-[10px]">
        <Card.Icon className="h-[36px] w-[36px] shrink-0 rounded-full">
          <Icon as={GraduationCap} size={18} />
        </Card.Icon>
        <Card.Title className="min-w-0 flex-1" title={skill.name}>
          {skill.name}
        </Card.Title>
        {actions === undefined ? null : <Card.End>{actions}</Card.End>}
      </div>
      <Card.Description className="line-clamp-2" title={skill.description ?? undefined}>
        {skill.description ?? t('skill.noDescription')}
      </Card.Description>
      {tags.length === 0
        ? null
        : (
            <div className="flex flex-wrap items-center gap-[6px]">
              {tags.map(tag => <Tag key={tag} tone="neutral">{tag}</Tag>)}
            </div>
          )}
    </Card>
  )
}
