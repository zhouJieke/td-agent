import type { ReactElement, ReactNode } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Action, ArrowDown, Card, ChevronDown, Cubes3Overlap, GraduationCap, Icon, Puzzle, Tag } from 'dsh-tauri-ui/client'
import { isEmpty } from 'dsh-tauri/client'
import { useState } from 'react'
import { daysSince, parseBizTags } from '../store/modules/skill.utils'
import { SkillDownloadHints } from './skill-download'

interface SkillCardProps {
  t: Translate
  skill: SkillSummary
  /** 行尾操作区，由管理页传入；只读页面不传。 */
  actions?: ReactNode
}

function countText(value: number | null | undefined): string {
  if (value === null || value === undefined)
    return '-'
  return value >= 10_000 ? `${(value / 10_000).toFixed(2)}万` : String(value)
}

export function SkillCard({ t, skill, actions }: SkillCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [now] = useState(() => Date.now())
  const latest = skill.labels.latest
  const tags = parseBizTags(skill.bizTags)
  const days = skill.updateTime === null ? null : daysSince(skill.updateTime, now)

  return (
    <Card className="flex flex-col">
      <Card.Header className="items-start gap-[10px]">
        <Card.Icon className="bg-module-platform">
          <Icon as={GraduationCap} size={22} />
        </Card.Icon>
        <Card.Content>
          <Card.Title title={skill.name}>{skill.name}</Card.Title>
          <Card.Description title={skill.description ?? ''}>{skill.description ?? t('skill.noDescription')}</Card.Description>
          <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[2px] text-tertiary text-[12px] leading-[18px]">
            <span className="flex items-center gap-[4px]" title={t('skill.downloads', { count: skill.downloadCount ?? 0 })}>
              <Icon as={ArrowDown} size={13} />
              {countText(skill.downloadCount)}
            </span>
            <span className="flex items-center gap-[4px]" title={t('skill.onlineCnt')}>
              <Icon as={Cubes3Overlap} size={13} />
              {countText(skill.onlineCnt)}
            </span>
            <Tag tone={skill.enable ? 'success' : 'neutral'}>{skill.enable ? t('status.enabled') : t('status.disabled')}</Tag>
            {latest === undefined ? null : <Tag variant="version" tone="outline">{latest}</Tag>}
            <SkillDownloadHints t={t} name={skill.name} latestVersion={latest} />
            <span className="ml-auto inline-flex h-[20px] w-[20px] flex-none items-center justify-center rounded-sm bg-module-platform text-tertiary">
              <Icon as={Puzzle} size={13} />
            </span>
          </div>
        </Card.Content>
        <Card.End>
          <Action
            variant="toolbar"
            icon={<Icon as={ChevronDown} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />}
            aria-label={expanded ? t('skill.collapse') : t('skill.expand')}
            aria-expanded={expanded}
            title={expanded ? t('skill.collapse') : t('skill.expand')}
            onClick={() => setExpanded(value => !value)}
          />
          {actions}
        </Card.End>
      </Card.Header>
      {expanded
        ? (
            <div className="flex flex-col gap-[6px] px-[16px] pb-[12px] text-tertiary text-[12px] leading-[18px]">
              <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                {skill.owner === null
                  ? null
                  : (
                      <>
                        <span>{t('skill.owner', { name: skill.owner })}</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                {days === null
                  ? null
                  : (
                      <>
                        <span>{days === 0 ? t('skill.updatedToday') : t('skill.updatedDays', { days })}</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                {isEmpty(skill.scope) ? null : <Tag tone="quiet">{skill.scope}</Tag>}
                {tags.map(tag => (
                  <span key={tag} className="rounded-sm bg-module-platform px-[6px] py-[1px] text-[11px] leading-[17px]">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-[16px]">
                <span>
                  {t('skill.namespace')}
                  :
                  {' '}
                  <span className="font-mono text-secondary">{skill.namespaceId}</span>
                </span>
                <span>
                  {t('skill.from')}
                  :
                  {' '}
                  <span className="text-secondary">{skill.from ?? '-'}</span>
                </span>
              </div>
              {isEmpty(skill.editingVersion) && isEmpty(skill.reviewingVersion)
                ? null
                : (
                    <div className="flex flex-wrap gap-x-[16px]">
                      {isEmpty(skill.editingVersion)
                        ? null
                        : (
                            <span>
                              {t('skill.editingVersion')}
                              :
                              {' '}
                              <span className="font-mono text-secondary">{skill.editingVersion}</span>
                            </span>
                          )}
                      {isEmpty(skill.reviewingVersion)
                        ? null
                        : (
                            <span>
                              {t('skill.reviewingVersion')}
                              :
                              {' '}
                              <span className="font-mono text-secondary">{skill.reviewingVersion}</span>
                            </span>
                          )}
                    </div>
                  )}
            </div>
          )
        : null}
    </Card>
  )
}
