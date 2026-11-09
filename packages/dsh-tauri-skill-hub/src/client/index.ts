import type { ClientContext } from 'dsh-tauri/client'
import { LOCALE_EFFECT, PANEL_EFFECT, PLUGIN_ID, SKILL_CREATOR_PREFILL_EFFECT } from './constants'
import { locale } from './locales'
import { panelFeature } from './register/panel'
import { skillCreatorPrefillFeature } from './register/skill-creator-prefill'

export const name = PLUGIN_ID

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(locale.registerLocale, LOCALE_EFFECT)
  ctx.effect(skillCreatorPrefillFeature, SKILL_CREATOR_PREFILL_EFFECT)
  ctx.effect(panelFeature, PANEL_EFFECT)
}
