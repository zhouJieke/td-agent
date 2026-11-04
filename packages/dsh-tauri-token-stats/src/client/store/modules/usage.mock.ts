import type { TurnUsageRecord } from './usage.types'
import { dayKeyOf } from './usage.utils'

/**
 * UI 设计稿阶段的内存假数据：落账接入后台后整文件删除，store 改由 RPC 填充。
 * 用固定种子的线性同余生成，保证每次进入面板看到的是同一份曲线。
 */

const MOCK_DAYS = 30
const MOCK_SEED = 20_260_214

const MODEL_PROFILES = [
  { model: 'deepseek-chat', weight: 0.45, input: [1_200, 9_000], output: [400, 2_600], cache: [800, 6_000] },
  { model: 'deepseek-reasoner', weight: 0.35, input: [900, 5_200], output: [2_000, 12_000], cache: [300, 2_400] },
  { model: 'deepseek-v4-flash', weight: 0.2, input: [300, 2_200], output: [120, 900], cache: [200, 1_600] },
] as const

const MOCK_SESSIONS = [
  { id: 'sess-refactor-billing', title: '重构计费模块' },
  { id: 'sess-e2e-flaky', title: '修复 E2E 抖动用例' },
  { id: 'sess-plugin-loader', title: '插件加载器沙箱隔离' },
  { id: 'sess-design-tokens', title: '设计 token 对齐' },
  { id: 'sess-upstream-sync', title: '上游同步 0.1.7-rc.2' },
  { id: 'sess-release-notes', title: '发布说明整理' },
] as const

function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296
    return state / 4_294_967_296
  }
}

function between(random: () => number, [min, max]: readonly [number, number]): number {
  return Math.round(min + random() * (max - min))
}

function pickModel(random: () => number): typeof MODEL_PROFILES[number] {
  const hit = random()
  let cursor = 0
  for (const profile of MODEL_PROFILES) {
    cursor += profile.weight
    if (hit <= cursor)
      return profile
  }
  return MODEL_PROFILES[0]
}

export function createMockRecords(now = Date.now()): TurnUsageRecord[] {
  const random = createRandom(MOCK_SEED)
  const records: TurnUsageRecord[] = []
  for (let offset = MOCK_DAYS - 1; offset >= 0; offset--) {
    const weekday = new Date(now - offset * 86_400_000).getDay()
    const turns = offset === 0
      ? 1 + Math.floor(random() * 4)
      : weekday === 0 || weekday === 6
        ? 1 + Math.floor(random() * 3)
        : 3 + Math.floor(random() * 7)
    for (let index = 0; index < turns; index++) {
      const moment = new Date(now - offset * 86_400_000)
      moment.setHours(9 + Math.floor(random() * 14), Math.floor(random() * 60), 0, 0)
      if (moment.getTime() > now)
        continue
      const profile = pickModel(random)
      const session = MOCK_SESSIONS[Math.floor(random() * MOCK_SESSIONS.length)]
      const inputTokens = between(random, profile.input)
      const outputTokens = between(random, profile.output)
      const cacheTokens = between(random, profile.cache)
      records.push({
        id: `mock-${offset}-${index}`,
        timestamp: moment.getTime(),
        date: dayKeyOf(moment.getTime()),
        sessionId: session.id,
        sessionTitle: session.title,
        model: profile.model,
        inputTokens,
        outputTokens,
        cacheTokens,
        totalTokens: inputTokens + outputTokens + cacheTokens,
      })
    }
  }
  return records.sort((a, b) => a.timestamp - b.timestamp)
}
