import type { ClientContext } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../shared/constants'
import { LOCALE_EFFECT, STYLES_EFFECT } from './constants'
import { locale } from './locales'
import { registerStyles } from './register/styles'
import { configureOpenInApp } from './service/open-in-app'

export type { ModelsKey } from './models/locales.ts'
export type { ModelsSectionInjected, ModelsSectionProps } from './models/ModelsSection.tsx'
export type { ModelDiscoveryOutcome, ModelsOperations, SettingsWriteOutcome } from './models/operations.ts'
export type { ModelsFooterOwnerProps, ProviderCardExtrasOwnerProps } from './models/slot-contract.ts'
export type { ModelsSettingsState, ProviderDirectoryEntry, ProviderRow } from './models/store.ts'

export const name = PLUGIN_ID

export const inject = [
  'slots',
  'locale',
  'remote',
  'remote.credentials',
  'remote.llm',
  'remote.session',
  'remote.settings',
  'settingsSchema',
]

export function apply(ctx: ClientContext): void {
  configureOpenInApp(ctx)
  ctx.effect(locale.registerLocale, LOCALE_EFFECT)
  ctx.effect(registerStyles, STYLES_EFFECT)
}
