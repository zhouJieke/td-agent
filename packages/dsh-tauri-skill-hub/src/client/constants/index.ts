import type { LocaleKey } from '../locales/index.types'
import { PANEL_ORDER, PLUGIN_ID } from '../../shared/constants'

export { PLUGIN_ID } from '../../shared/constants'

export const PANEL_ID = PLUGIN_ID
export const PANEL_ACTION_ORDER = PANEL_ORDER

export const LOCALE_EFFECT = `${PLUGIN_ID}: locale`
export const PANEL_EFFECT = `${PLUGIN_ID}: panel`
export const SKILL_CREATOR_PREFILL_EFFECT = `${PLUGIN_ID}: skill creator prefill`

export const SKILL_TABS = ['enterprise', 'mine', 'local', 'manage'] as const

export const SOURCE_LOCALE_KEYS: Readonly<Record<string, LocaleKey>> = {
  'project-dsh': 'sourceProjectDsh',
  'project-agents': 'sourceProjectAgents',
  'user-dsh': 'sourceUserDsh',
  'user-agents': 'sourceUserAgents',
  'runtime': 'sourceRuntime',
  'bundled': 'sourceBundled',
  'custom': 'sourceCustom',
  'enterprise': 'sourceEnterprise',
}

/** 列表接口一次拉取的最大条数（不做分页控件）。 */
export const PAGE_SIZE = 200

/** 技能接口前缀（经桌面宿主同源代理转发到后端）。 */
export const SKILL_API_BASE = '/api'
