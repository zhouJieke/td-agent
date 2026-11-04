import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { UsageSummary } from '../store/modules/usage.types'
import { formatDayLabel, formatExact, formatTokens } from '../store/modules/usage.utils'

interface SummaryCardsProps {
  t: Translate
  summary: UsageSummary
  days: number
}

interface MetricProps {
  label: string
  value: string
  title?: string
  hint?: string
}

function Metric({ label, value, title, hint }: MetricProps): ReactElement {
  return (
    <div
      className="box-border flex flex-col gap-[6px] min-w-0 rounded-xl border border-border-l2 bg-layer-3 px-[14px] py-[12px]"
      title={title}
    >
      <span className="text-tertiary text-[12px] leading-[18px]">{label}</span>
      <span className="text-[22px] leading-[28px] font-medium tabular-nums">{value}</span>
      {hint
        ? <span className="truncate text-tertiary text-[12px] leading-[18px]">{hint}</span>
        : null}
    </div>
  )
}

export function SummaryCards({ t, summary, days }: SummaryCardsProps): ReactElement {
  const perTurn = summary.rangeTurns === 0 ? 0 : summary.rangeTokens / summary.rangeTurns
  return (
    <div className="grid gap-[12px] grid-cols-2 lg:grid-cols-4">
      <Metric
        label={t('card.today')}
        value={formatTokens(summary.todayTokens)}
        title={formatExact(summary.todayTokens)}
        hint={t('card.turns', { count: summary.todayTurns })}
      />
      <Metric
        label={t('card.range')}
        value={formatTokens(summary.rangeTokens)}
        title={formatExact(summary.rangeTokens)}
        hint={t('card.days', { days })}
      />
      <Metric
        label={t('card.average')}
        value={formatTokens(summary.dailyAverage)}
        title={formatExact(summary.dailyAverage)}
        hint={summary.peakDate === ''
          ? t('card.turns', { count: summary.rangeTurns })
          : t('card.peak', { date: formatDayLabel(summary.peakDate), tokens: formatTokens(summary.peakTokens) })}
      />
      <Metric
        label={t('card.todayTurns')}
        value={String(summary.todayTurns)}
        hint={t('card.perTurn', { tokens: formatTokens(perTurn) })}
      />
    </div>
  )
}
