import type { ReactElement, ReactNode } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillSummary } from '../types'
import { Action, Card, ChevronDown, GraduationCap, Icon, Tag } from 'dsh-tauri-ui/client'
import { isEmpty } from 'dsh-tauri/client'
import { useState } from 'react'
import { daysSince, parseBizTags, skillTitle } from '../store/modules/skill.utils'

interface SkillCardProps {
  t: Translate
  skill: SkillSummary
  /** 行尾操作区，由管理页传入；只读页面不传。 */
  actions?: ReactNode
}

export function SkillCard({ t, skill, actions }: SkillCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [now] = useState(() => Date.now())
  const latest = skill.labels.latest
  const tags = parseBizTags(skill.bizTags)
  const days = skill.updateTime === null ? null : daysSince(skill.updateTime, now)

  return (
    <Card>
      <Card.Header>
        <Card.Icon>
          <Icon as={GraduationCap} size={20} />
        </Card.Icon>
        <Card.Content>
          <Card.TitleRow>
            <Card.Title title={skillTitle(skill)}>{skillTitle(skill)}</Card.Title>
            {latest === undefined ? null : <Tag variant="version" tone="outline">{latest}</Tag>}
            <Tag tone={skill.enable ? 'success' : 'neutral'}>{skill.enable ? t('status.enabled') : t('status.disabled')}</Tag>
            {isEmpty(skill.scope) ? null : <Tag tone="quiet">{skill.scope}</Tag>}
          </Card.TitleRow>
          <Card.Description title={skill.description ?? ''}>{skill.description ?? t('skill.noDescription')}</Card.Description>
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-tertiary text-[12px] leading-[18px]">
            <span className="font-mono">{skill.name}</span>
            {skill.owner === null
              ? null
              : (
                  <>
                    <span aria-hidden>·</span>
                    <span>{t('skill.owner', { name: skill.owner })}</span>
                  </>
                )}
            {days === null
              ? null
              : (
                  <>
                    <span aria-hidden>·</span>
                    <span>{days === 0 ? t('skill.updatedToday') : t('skill.updatedDays', { days })}</span>
                  </>
                )}
            {skill.downloadCount === null
              ? null
              : (
                  <>
                    <span aria-hidden>·</span>
                    <span>{t('skill.downloads', { count: skill.downloadCount })}</span>
                  </>
                )}
            {tags.map(tag => (
              <span key={tag} className="rounded-sm bg-module-platform px-[6px] py-[1px] text-[11px] leading-[17px]">
                {tag}
              </span>
            ))}
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
                <span>
                  {t('skill.onlineCnt')}
                  :
                  {' '}
                  <span className="text-secondary">{skill.onlineCnt ?? '-'}</span>
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
              {Object.keys(skill.labels).length === 0
                ? null
                : (
                    <div className="flex flex-wrap gap-[6px]">
                      {Object.entries(skill.labels).map(([label, version]) => (
                        <Tag key={label} variant="version" tone="neutral">
                          {label}
                          :
                          {' '}
                          {version}
                        </Tag>
                      ))}
                    </div>
                  )}
            </div>
          )
        : null}
    </Card>
  )
}
