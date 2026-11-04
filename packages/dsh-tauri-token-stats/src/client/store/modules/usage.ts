import type { BreakdownDimension, RangePreset, UsageUiState } from './usage.types'
import { defineStore } from 'dsh-tauri/client'
import { createMockRecords } from './usage.mock'

export const usage = defineStore({
  state: (): UsageUiState => ({
    records: createMockRecords(),
    range: 7,
    dimension: 'model',
  }),
  actions: {
    setRange(range: RangePreset) {
      this.range = range
    },
    setDimension(dimension: BreakdownDimension) {
      this.dimension = dimension
    },
  },
})
