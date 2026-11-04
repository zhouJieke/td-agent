import type { ClientContext } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../shared/constants'
import { LOCALE_EFFECT, PANEL_EFFECT } from './constants'
import { locale } from './locales'
import { panelFeature } from './register/panel'

export const name = PLUGIN_ID

export const inject = ['slots', 'layout', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(locale.registerLocale, LOCALE_EFFECT)
  ctx.effect(panelFeature, PANEL_EFFECT)
}
