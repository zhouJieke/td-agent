import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Panel, SegmentedControl } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { useMemo } from 'react'
import { store } from '../store'
import { aggregateDaily, breakdown, groupTurnsByDay, summarize, toRange, withinDays } from '../store/modules/usage.utils'
import { Breakdown } from './breakdown'
import { DailyChart } from './daily-chart'
import { SummaryCards } from './summary-cards'
import { TurnList } from './turn-list'

const DETAIL_DAYS_CAP = 7

export function TokenStatsPanel({ t }: { t: Translate }): ReactElement {
  const state = useStore(store.usage)
  const range = state.range
  const scoped = useMemo(() => withinDays(state.records, range), [state.records, range])
  const daily = useMemo(() => aggregateDaily(scoped, range), [scoped, range])
  const summary = useMemo(() => summarize(daily), [daily])
  const items = useMemo(() => breakdown(scoped, state.dimension), [scoped, state.dimension])
  const detailDays = Math.min(range, DETAIL_DAYS_CAP)
  const groups = useMemo(() => groupTurnsByDay(scoped, detailDays), [scoped, detailDays])

  return (
    <Panel>
      <div className="box-border flex flex-col gap-[16px] font-sans text-primary text-[13px] leading-[1.5]">
        <header className="flex items-start justify-between gap-[16px]">
          <div className="min-w-0">
            <h1 className="m-0 text-[20px] leading-[28px] font-medium">{t('tokenStats')}</h1>
            <p className="mt-[4px] mx-0 mb-0 text-secondary text-[13px] leading-[20px]">{t('subtitle')}</p>
          </div>
          <SegmentedControl
            label={t('range.label')}
            value={String(range)}
            options={[
              { value: '7', label: t('range.7') },
              { value: '30', label: t('range.30') },
            ]}
            onChange={next => store.usage.setRange(toRange(next))}
          />
        </header>

        <div className="flex items-start gap-[8px] rounded-lg border border-border-l2 bg-module-platform px-[12px] py-[8px]">
          <span className="flex-none mt-[6px] inline-block w-[6px] h-[6px] rounded-full bg-warn" />
          <p className="m-0 text-secondary text-[12px] leading-[18px]">
            <span className="text-primary font-medium">{t('mockBadge')}</span>
            {' · '}
            {t('mockHint')}
          </p>
        </div>

        <SummaryCards t={t} summary={summary} days={range} />
        <DailyChart t={t} daily={daily} range={range} />
        <Breakdown
          t={t}
          items={items}
          dimension={state.dimension}
          onDimensionChange={dimension => store.usage.setDimension(dimension)}
        />
        <TurnList t={t} groups={groups} days={detailDays} />
      </div>
    </Panel>
  )
}
