import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { TurnDayGroup } from '../store/modules/usage.utils'
import { Text } from 'dsh-tauri-ui/client'
import { formatDayLabel, formatExact, formatTime, formatTokens } from '../store/modules/usage.utils'
import { Section } from './section'

interface TurnListProps {
  t: Translate
  groups: readonly TurnDayGroup[]
  days: number
}

const GRID = 'grid grid-cols-[52px_minmax(0,1fr)_minmax(0,132px)_56px_56px_56px_68px] gap-x-[10px] items-center'
const NUMERIC = 'text-right text-tertiary text-[12px] leading-[18px] tabular-nums'

export function TurnList({ t, groups, days }: TurnListProps): ReactElement {
  return (
    <Section title={t('turns.title')} subtitle={t('turns.subtitle', { days })}>
      {groups.length === 0
        ? <Text tone="tertiary" size="xs">{t('turns.empty')}</Text>
        : (
            <div className="max-h-[480px] overflow-auto rounded-lg border border-border-l2">
              <div className={`${GRID} sticky top-0 z-[1] px-[10px] py-[7px] border-b border-border-l2 bg-module-platform text-tertiary text-[12px] leading-[18px]`}>
                <span>{t('turns.colTime')}</span>
                <span>{t('turns.colSession')}</span>
                <span>{t('turns.colModel')}</span>
                <span className="text-right">{t('turns.colInput')}</span>
                <span className="text-right">{t('turns.colOutput')}</span>
                <span className="text-right">{t('turns.colCache')}</span>
                <span className="text-right">{t('turns.colTotal')}</span>
              </div>
              {groups.map(group => (
                <div key={group.date}>
                  <div className="flex items-center justify-between gap-[12px] px-[10px] py-[6px] border-t border-border-l2 bg-module-platform">
                    <span className="text-primary text-[12px] leading-[18px] font-medium">{formatDayLabel(group.date)}</span>
                    <span className="text-tertiary text-[12px] leading-[18px] tabular-nums">
                      {t('turns.dayTotal', { count: group.turns, tokens: formatTokens(group.totalTokens) })}
                    </span>
                  </div>
                  {group.items.map(item => (
                    <div key={item.id} className={`${GRID} px-[10px] py-[6px] hover:bg-hover`}>
                      <span className="text-tertiary text-[12px] leading-[18px] tabular-nums">{formatTime(item.timestamp)}</span>
                      <span className="truncate text-primary text-[13px] leading-[20px]">{item.sessionTitle}</span>
                      <span className="truncate text-tertiary text-[12px] leading-[18px]">{item.model}</span>
                      <span className={NUMERIC} title={formatExact(item.inputTokens)}>{formatTokens(item.inputTokens)}</span>
                      <span className={NUMERIC} title={formatExact(item.outputTokens)}>{formatTokens(item.outputTokens)}</span>
                      <span className={NUMERIC} title={formatExact(item.cacheTokens)}>{formatTokens(item.cacheTokens)}</span>
                      <span className="text-right text-primary text-[13px] leading-[20px] font-medium tabular-nums" title={formatExact(item.totalTokens)}>
                        {formatTokens(item.totalTokens)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
      <Text className="mt-[10px]" tone="tertiary" size="xs">{t('turns.more', { days })}</Text>
    </Section>
  )
}
