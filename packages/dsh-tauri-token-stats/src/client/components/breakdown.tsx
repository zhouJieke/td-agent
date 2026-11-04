import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { BreakdownDimension, BreakdownItem } from '../store/modules/usage.types'
import { SegmentedControl, Text } from 'dsh-tauri-ui/client'
import { formatExact, formatPercent, formatTokens, toDimension } from '../store/modules/usage.utils'
import { Section } from './section'

interface BreakdownProps {
  t: Translate
  items: readonly BreakdownItem[]
  dimension: BreakdownDimension
  onDimensionChange: (dimension: BreakdownDimension) => void
}

export function Breakdown({ t, items, dimension, onDimensionChange }: BreakdownProps): ReactElement {
  return (
    <Section
      title={t('breakdown.title')}
      control={(
        <SegmentedControl
          label={t('breakdown.dimension')}
          value={dimension}
          options={[
            { value: 'model', label: t('dimension.model') },
            { value: 'session', label: t('dimension.session') },
          ]}
          onChange={next => onDimensionChange(toDimension(next))}
        />
      )}
    >
      {items.length === 0
        ? <Text tone="tertiary" size="xs">{t('breakdown.empty')}</Text>
        : (
            <ul className="m-0 p-0 list-none">
              {items.map(item => (
                <li
                  key={item.key}
                  className="flex items-center gap-[12px] py-[7px]"
                  title={t('breakdown.item', {
                    label: item.label,
                    tokens: formatExact(item.totalTokens),
                    share: formatPercent(item.share),
                  })}
                >
                  <span className="flex-none w-[136px] min-w-0 truncate text-secondary text-[13px] leading-[20px]">
                    {item.label}
                  </span>
                  <span className="relative flex-1 min-w-0 h-[6px] overflow-hidden rounded-full bg-module-platform">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-business"
                      style={{ width: `${Math.max(item.share * 100, 1)}%` }}
                    />
                  </span>
                  <span className="flex-none w-[52px] text-right text-tertiary text-[12px] leading-[18px] tabular-nums">
                    {item.turns}
                  </span>
                  <span className="flex-none w-[64px] text-right text-primary text-[13px] leading-[20px] tabular-nums">
                    {formatTokens(item.totalTokens)}
                  </span>
                  <span className="flex-none w-[44px] text-right text-tertiary text-[12px] leading-[18px] tabular-nums">
                    {formatPercent(item.share)}
                  </span>
                </li>
              ))}
            </ul>
          )}
    </Section>
  )
}
