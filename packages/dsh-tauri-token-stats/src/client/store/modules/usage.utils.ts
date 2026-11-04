import type { BreakdownDimension, BreakdownItem, DailyUsage, RangePreset, TurnUsageRecord, UsageSummary } from './usage.types'
import { format } from 'dsh-tauri/client'

export function toRange(value: string): RangePreset {
  return value === '30' ? 30 : 7
}

export function toDimension(value: string): BreakdownDimension {
  return value === 'session' ? 'session' : 'model'
}

export function dayKeyOf(timestamp: number): string {
  return format(new Date(timestamp), 'yyyy-MM-dd')
}

/** 最近 `days` 个自然日（含今天）的 `yyyy-MM-dd`，按时间升序。 */
export function recentDayKeys(days: number, now = Date.now()): string[] {
  const keys: string[] = []
  for (let offset = days - 1; offset >= 0; offset--)
    keys.push(dayKeyOf(now - offset * 86_400_000))
  return keys
}

export function withinDays(records: readonly TurnUsageRecord[], days: number, now = Date.now()): TurnUsageRecord[] {
  const keys = new Set(recentDayKeys(days, now))
  return records.filter(record => keys.has(record.date))
}

export function totalOf(records: readonly TurnUsageRecord[], field: keyof Pick<TurnUsageRecord, 'inputTokens' | 'outputTokens' | 'cacheTokens' | 'totalTokens'>): number {
  let total = 0
  for (const record of records)
    total += record[field]
  return total
}

/** 按日聚合：区间内没有消耗的日期补零，保证柱状图横轴连续。 */
export function aggregateDaily(records: readonly TurnUsageRecord[], days: number, now = Date.now()): DailyUsage[] {
  const buckets = new Map<string, DailyUsage>()
  for (const date of recentDayKeys(days, now)) {
    buckets.set(date, { date, turns: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, totalTokens: 0 })
  }
  for (const record of records) {
    const bucket = buckets.get(record.date)
    if (!bucket)
      continue
    bucket.turns += 1
    bucket.inputTokens += record.inputTokens
    bucket.outputTokens += record.outputTokens
    bucket.cacheTokens += record.cacheTokens
    bucket.totalTokens += record.totalTokens
  }
  return [...buckets.values()]
}

export function summarize(daily: readonly DailyUsage[], now = Date.now()): UsageSummary {
  const today = daily.find(item => item.date === dayKeyOf(now))
  let rangeTokens = 0
  let rangeTurns = 0
  let peakDate = ''
  let peakTokens = 0
  for (const item of daily) {
    rangeTokens += item.totalTokens
    rangeTurns += item.turns
    if (item.totalTokens > peakTokens) {
      peakTokens = item.totalTokens
      peakDate = item.date
    }
  }
  return {
    todayTokens: today?.totalTokens ?? 0,
    todayTurns: today?.turns ?? 0,
    rangeTokens,
    rangeTurns,
    dailyAverage: daily.length === 0 ? 0 : Math.round(rangeTokens / daily.length),
    peakDate,
    peakTokens,
  }
}

export function breakdown(records: readonly TurnUsageRecord[], dimension: BreakdownDimension, limit = 6): BreakdownItem[] {
  const groups = new Map<string, { label: string, turns: number, totalTokens: number }>()
  for (const record of records) {
    const key = dimension === 'model' ? record.model : record.sessionId
    const group = groups.get(key) ?? { label: dimension === 'model' ? record.model : record.sessionTitle, turns: 0, totalTokens: 0 }
    group.turns += 1
    group.totalTokens += record.totalTokens
    groups.set(key, group)
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.totalTokens, 0)
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      turns: group.turns,
      totalTokens: group.totalTokens,
      share: total === 0 ? 0 : group.totalTokens / total,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit)
}

export interface TurnDayGroup {
  date: string
  turns: number
  totalTokens: number
  items: TurnUsageRecord[]
}

/** 明细列表分组：日期倒序，组内按时间倒序。 */
export function groupTurnsByDay(records: readonly TurnUsageRecord[], limit = 7): TurnDayGroup[] {
  const groups = new Map<string, TurnUsageRecord[]>()
  for (const record of records) {
    const bucket = groups.get(record.date)
    if (bucket)
      bucket.push(record)
    else
      groups.set(record.date, [record])
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([date, items]) => {
      const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp)
      return { date, items: sorted, turns: sorted.length, totalTokens: totalOf(sorted, 'totalTokens') }
    })
}

/** 柱状图纵轴上限：向上取整到 1/2/5 × 10^n，避免最高柱贴顶。 */
export function chartCeiling(values: readonly number[]): number {
  const peak = values.reduce((max, value) => (value > max ? value : max), 0)
  if (peak <= 0)
    return 1
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  for (const step of [1, 2, 5, 10]) {
    if (peak <= step * magnitude)
      return step * magnitude
  }
  return 10 * magnitude
}

export function formatTokens(value: number): string {
  if (value < 1_000)
    return String(value)
  if (value < 1_000_000)
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 2 : 1)}M`
}

export function formatExact(value: number): string {
  const text = String(Math.round(value))
  const parts: string[] = []
  for (let end = text.length; end > 0; end -= 3)
    parts.unshift(text.slice(Math.max(0, end - 3), end))
  return parts.join(',')
}

export function formatPercent(share: number): string {
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`
}

export function formatDayLabel(date: string): string {
  return date.slice(5).replace('-', '/')
}

export function formatTime(timestamp: number): string {
  return format(new Date(timestamp), 'HH:mm')
}
