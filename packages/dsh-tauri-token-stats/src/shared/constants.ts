/**
 * shared/constants.ts — dsh-tauri-token-stats 宿主/客户端共享的协议常量。
 *
 * 落账接入后台后，宿主侧（订阅 `agent/assistant-stream` 的 usage chunk 与
 * `session/event` 的 `turn/end`）与客户端侧（RPC 读取）会共用这里的键名与命名空间。
 */

/** 插件名（诊断元数据、locale 命名空间、面板 id 与存储 key 前缀）。 */
export const PLUGIN_ID = 'dsh-tauri-token-stats'

/** 面板在 `sidebar.panellist` 的排序权重（extension=20 / scheduler=30 / playground=50 之间）。 */
export const PANEL_ORDER = 40

/** 按日趋势的可选区间（天）。 */
export const RANGE_PRESETS = [7, 30] as const

/** 维度拆分的可选口径。 */
export const BREAKDOWN_DIMENSIONS = ['model', 'session'] as const
