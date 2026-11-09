import type { HostContext } from 'dsh-tauri'
import { PLUGIN_ID } from '../shared/constants'
import { server } from './server'
import { provider } from './service/provider'

export function apply(ctx: HostContext): void {
  ctx.effect(() => server(ctx), `${PLUGIN_ID}: routes`)
  ctx.inject(['skills', 'loader'], () => provider.initialize())
}
