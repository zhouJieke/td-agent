import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillDetail, UserSkillDetails } from '../types'
import { Action, Card, ChevronDown, GraduationCap, Icon, Tag, Text, TriangleExclamation } from 'dsh-tauri-ui/client'
import { isEmpty } from 'dsh-tauri/client'
import { useState } from 'react'
import { skillTitle } from '../store/modules/skill.utils'
import { SkillDownload } from './skill-download'

interface MineViewProps {
  t: Translate
  mine: UserSkillDetails | null
  hint: string
  emptyText: string
}

function VersionRows({ t, detail }: { t: Translate, detail: SkillDetail }): ReactElement {
  if (detail.versions.length === 0)
    return <Text tone="tertiary" size="xs" className="px-[16px] pb-[12px]">{t('mine.noVersions')}</Text>
  return (
    <div className="px-[16px] pb-[12px]">
      <table className="w-full border-collapse text-[12px] leading-[18px]">
        <thead>
          <tr className="text-left text-tertiary">
            <th className="py-[4px] pr-[12px] font-normal">{t('mine.version')}</th>
            <th className="py-[4px] pr-[12px] font-normal">{t('mine.status')}</th>
            <th className="py-[4px] pr-[12px] font-normal">{t('mine.author')}</th>
            <th className="py-[4px] font-normal">{t('mine.commitMsg')}</th>
          </tr>
        </thead>
        <tbody>
          {detail.versions.map(version => (
            <tr key={version.version} className="border-t border-border-l2 text-secondary">
              <td className="py-[6px] pr-[12px] font-mono">{version.version}</td>
              <td className="py-[6px] pr-[12px]"><Tag tone={version.status === 'online' ? 'success' : 'quiet'}>{version.status}</Tag></td>
              <td className="py-[6px] pr-[12px]">{version.author ?? '-'}</td>
              <td className="py-[6px] text-tertiary">{version.commitMsg ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DetailCard({ t, detail }: { t: Translate, detail: SkillDetail }): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const summary = detail.summary
  const latest = summary.labels.latest

  return (
    <Card>
      <Card.Header>
        <Card.Icon>
          <Icon as={GraduationCap} size={20} />
        </Card.Icon>
        <Card.Content>
          <Card.TitleRow>
            <Card.Title title={skillTitle(summary)}>{skillTitle(summary)}</Card.Title>
            {latest === undefined ? null : <Tag variant="version" tone="outline">{latest}</Tag>}
            <Tag tone={summary.enable ? 'success' : 'neutral'}>{summary.enable ? t('status.enabled') : t('status.disabled')}</Tag>
          </Card.TitleRow>
          <Card.Description title={summary.description ?? ''}>{summary.description ?? t('skill.noDescription')}</Card.Description>
          <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-tertiary text-[12px] leading-[18px]">
            <span className="font-mono">{summary.name}</span>
            <span aria-hidden>·</span>
            <span>{t('mine.versionCount', { count: detail.versions.length })}</span>
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
          <SkillDownload t={t} name={summary.name} latestVersion={summary.labels.latest} />
        </Card.End>
      </Card.Header>
      {expanded ? <VersionRows t={t} detail={detail} /> : null}
    </Card>
  )
}

export function MineView({ t, mine, hint, emptyText }: MineViewProps): ReactElement {
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="m-0 text-secondary text-[13px] leading-[20px]">{hint}</p>
      {mine === null || (mine.skills.length === 0 && mine.failed.length === 0)
        ? <Text tone="tertiary" size="sm" className="py-[32px] text-center">{emptyText}</Text>
        : mine.skills.length === 0
          ? null
          : (
              <Card.List className="gap-[8px]">
                {mine.skills.map(detail => (
                  <DetailCard key={`${detail.summary.namespaceId}/${detail.summary.name}`} t={t} detail={detail} />
                ))}
              </Card.List>
            )}
      {mine === null || mine.failed.length === 0
        ? null
        : (
            <div className="flex flex-col gap-[6px] rounded-lg border border-border-l2 bg-layer-3 px-[12px] py-[10px]">
              <span className="flex items-center gap-[6px] text-secondary text-[12px] leading-[18px]">
                <Icon as={TriangleExclamation} size={14} />
                {t('mine.failedTitle', { count: mine.failed.length })}
              </span>
              {mine.failed.map(item => (
                <div key={item.name} className="flex items-center justify-between gap-[8px] text-tertiary text-[12px] leading-[18px]">
                  <span>
                    <span className="font-mono text-secondary">{item.name}</span>
                    {isEmpty(item.reason) ? null : ` · ${item.reason}`}
                  </span>
                  <SkillDownload t={t} name={item.name} />
                </div>
              ))}
            </div>
          )}
    </div>
  )
}
