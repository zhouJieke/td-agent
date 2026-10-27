import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config/onboarding'
import type { HostContext } from './types'
import { PLUGIN_ID } from '../shared/constants'
import { ONBOARDING_CONFIG_GLOBAL } from '../shared/onboarding-config'
import { server } from './server'
import { gateway } from './service/gateway'

const INDEX_EFFECT = `${PLUGIN_ID}: onboarding config global`

const ROUTES_EFFECT = `${PLUGIN_ID}: routes`

const GATEWAY_EFFECT = `${PLUGIN_ID}: backend model provisioning`

export function apply(ctx: HostContext, config?: Config): void {
  ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: ONBOARDING_CONFIG_GLOBAL,
      value: { credentialOnboarding: config?.credentialOnboarding ?? true },
    })
  }), INDEX_EFFECT)

  ctx.effect(() => server(ctx as unknown as Context), ROUTES_EFFECT)

  ctx.effect(() => gateway.start(), GATEWAY_EFFECT)
}
