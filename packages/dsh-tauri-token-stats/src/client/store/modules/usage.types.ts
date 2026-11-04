import type { BREAKDOWN_DIMENSIONS, RANGE_PRESETS } from '../../constants'

/** 单轮 token 消耗记录（后续由宿主 `turn/end` 落账，当前为 mock）。 */
export interface TurnUsageRecord {
  id: string
  timestamp: number
  date: string
  sessionId: string
  sessionTitle: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  totalTokens: number
}

/** 按日聚合结果。 */
export interface DailyUsage {
  date: string
  turns: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
  totalTokens: number
}

/** 维度拆分条目（模型 / 会话）。 */
export interface BreakdownItem {
  key: string
  label: string
  turns: number
  totalTokens: number
  share: number
}

/** 区间汇总。 */
export interface UsageSummary {
  todayTokens: number
  todayTurns: number
  rangeTokens: number
  rangeTurns: number
  dailyAverage: number
  peakDate: string
  peakTokens: number
}

export type RangePreset = typeof RANGE_PRESETS[number]

export type BreakdownDimension = typeof BREAKDOWN_DIMENSIONS[number]

export interface UsageUiState {
  records: TurnUsageRecord[]
  range: RangePreset
  dimension: BreakdownDimension
}
