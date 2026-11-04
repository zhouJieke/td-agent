import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { DailyUsage, RangePreset } from '../store/modules/usage.types'
import { Text } from 'dsh-tauri-ui/client'
import { useState } from 'react'
import { chartCeiling, formatDayLabel, formatExact, formatTokens } from '../store/modules/usage.utils'
import { Section } from './section'

interface DailyChartProps {
  t: Translate
  daily: readonly DailyUsage[]
  range: RangePreset
}

const CHART_HEIGHT = 152
const LABEL_STEP_30 = 5

const TIP_SURFACE = 'rounded-[12px] border-0 bg-[var(--dsw-specific-menu)] [backdrop-filter:var(--dsw-menu-backdrop-filter)] shadow-[var(--dsw-elevation-prominent)] [--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)]'

function TipCell({ label, value }: { label: string, value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="text-tertiary text-[11px] leading-[16px]">{label}</span>
      <span className="text-secondary text-[12px] leading-[18px] tabular-nums">{value}</span>
    </div>
  )
}

export function DailyChart({ t, daily, range }: DailyChartProps): ReactElement {
  const [hovered, setHovered] = useState('')
  const ceiling = chartCeiling(daily.map(item => item.totalTokens))
  const lastDate = daily[daily.length - 1]?.date ?? ''
  const labelStep = range === 7 ? 1 : LABEL_STEP_30
  const empty = daily.every(item => item.totalTokens === 0)

  return (
    <Section title={t('chart.title')} subtitle={t('chart.unit')}>
      {empty
        ? <Text tone="tertiary" size="xs">{t('chart.empty')}</Text>
        : (
            <div className="flex gap-[10px]" role="img" aria-label={t('chart.title')}>
              <div className="flex flex-col justify-between flex-none w-[44px] text-right text-tertiary text-[11px] leading-[14px] tabular-nums">
                <span>{formatTokens(ceiling)}</span>
                <span>{formatTokens(ceiling / 2)}</span>
                <span>0</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="relative">
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    <span className="h-px w-full bg-border-l2" />
                    <span className="h-px w-full bg-border-l2" />
                    <span className="h-px w-full bg-border-l2" />
                  </div>
                  <div className="relative flex items-end gap-[3px]" style={{ height: CHART_HEIGHT }}>
                    {daily.map((item, index) => {
                      const isToday = item.date === lastDate
                      const blank = item.totalTokens === 0
                      const align = index < 2
                        ? 'left-0'
                        : index > daily.length - 3
                          ? 'right-0'
                          : 'left-1/2 -translate-x-1/2'
                      return (
                        <div
                          key={item.date}
                          className="relative flex flex-col justify-end flex-1 min-w-0 h-full"
                          aria-label={t('chart.bar', { date: item.date, tokens: formatExact(item.totalTokens), count: item.turns })}
                          onMouseEnter={() => setHovered(item.date)}
                          onMouseLeave={() => setHovered('')}
                        >
                          {hovered === item.date && !blank
                            ? (
                                <div className={`pointer-events-none absolute bottom-[calc(100%+8px)] z-[5] w-max min-w-[152px] ${align}`}>
                                  <div className={`flex flex-col gap-[6px] px-[12px] py-[10px] ${TIP_SURFACE}`}>
                                    <div className="flex items-baseline justify-between gap-[16px]">
                                      <span className="text-secondary text-[12px] leading-[18px]">{isToday ? t('chart.today') : formatDayLabel(item.date)}</span>
                                      <span className="text-tertiary text-[11px] leading-[16px] tabular-nums">{t('card.turns', { count: item.turns })}</span>
                                    </div>
                                    <div className="text-primary text-[16px] leading-[22px] font-medium tabular-nums">
                                      {formatExact(item.totalTokens)}
                                      <span className="ml-[4px] text-tertiary text-[11px] leading-[16px] font-normal">{t('chart.unitShort')}</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-[12px] border-t border-border-l2 pt-[6px]">
                                      <TipCell label={t('turns.colInput')} value={formatTokens(item.inputTokens)} />
                                      <TipCell label={t('turns.colOutput')} value={formatTokens(item.outputTokens)} />
                                      <TipCell label={t('turns.colCache')} value={formatTokens(item.cacheTokens)} />
                                    </div>
                                  </div>
                                </div>
                              )
                            : null}
                          <span
                            className={isToday
                              ? 'w-full rounded-t-[3px] bg-brand'
                              : blank
                                ? 'w-full h-[2px] rounded-full bg-border-l3'
                                : 'w-full rounded-t-[3px] bg-business'}
                            style={blank ? undefined : { height: `${Math.max(item.totalTokens / ceiling * 100, 1.5)}%` }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="mt-[6px] flex gap-[3px]">
                  {daily.map((item, index) => {
                    const isToday = item.date === lastDate
                    const shown = index % labelStep === 0 || index === daily.length - 1
                    return (
                      <span
                        key={item.date}
                        className={isToday
                          ? 'flex-1 min-w-0 truncate text-center text-[11px] leading-[14px] text-primary font-medium'
                          : 'flex-1 min-w-0 truncate text-center text-[11px] leading-[14px] text-tertiary'}
                      >
                        {shown ? (isToday ? t('chart.today') : formatDayLabel(item.date)) : ''}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
    </Section>
  )
}
