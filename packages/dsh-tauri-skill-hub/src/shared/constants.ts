/**
 * shared/constants.ts — dsh-tauri-skill-hub 宿主/客户端共享的协议常量。
 *
 * 接入 Nacos 后，宿主侧（`host/server/index.ts` 的技能读写路由）与客户端侧
 * （`apis/index.ts` 由 genapi 生成）会共用这里的插件名与面板排序权重。
 */

/** 插件名（诊断元数据、locale 命名空间、面板 id 与存储 key 前缀）。 */
export const PLUGIN_ID = 'dsh-tauri-skill-hub'

/** 面板在 `sidebar.panellist` 的排序权重（extension=20 / scheduler=30 / token-stats=40 / playground=50 之后）。 */
export const PANEL_ORDER = 60
