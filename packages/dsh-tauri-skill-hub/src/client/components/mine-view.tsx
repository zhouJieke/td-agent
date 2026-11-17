import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { UserSkillDetails } from '../types'
import { Icon, Text, TriangleExclamation } from 'dsh-tauri-ui/client'
import { isEmpty } from 'dsh-tauri/client'
import { openSkillDetail } from '../service/skill'
import { SkillDownloadAction } from './skill-download'
import { SkillList } from './skill-list'

interface MineViewProps {
  t: Translate
  mine: UserSkillDetails | null
  hint: string
  emptyText: string
}

/** 我的技能页：与企业公用技能一致的「名称 + 简介」卡片；点击卡片打开只读详情。 */
export function MineView({ t, mine, hint, emptyText }: MineViewProps): ReactElement {
  return (
    <div className="flex flex-col gap-[12px]">
      <p className="m-0 text-secondary text-[13px] leading-[20px]">{hint}</p>
      {mine !== null && mine.skills.length > 0
        ? (
            <SkillList
              t={t}
              skills={mine.skills.map(detail => detail.summary)}
              emptyText={emptyText}
              actions={skill => <SkillDownloadAction t={t} name={skill.name} latestVersion={skill.labels.latest} />}
              onSelect={openSkillDetail}
            />
          )
        : mine !== null && mine.failed.length > 0
          ? null
          : <Text tone="tertiary" size="sm" className="py-[32px] text-center">{emptyText}</Text>}
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
                  <SkillDownloadAction t={t} name={item.name} />
                </div>
              ))}
            </div>
          )}
    </div>
  )
}
