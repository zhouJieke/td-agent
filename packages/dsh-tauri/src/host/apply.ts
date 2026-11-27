import type { ConnectionHost, HostContext } from './types'
import process from 'node:process'
import { PLUGIN_ID } from '../shared/constants'
import { MEDIA_RECORDER_SHIM_SCRIPT } from './media-recorder-shim'
import { desktopIdentity } from './prompts/desktop-identity'
import { server } from './server'
import { gate } from './service/gate'

const GATE_EFFECT = `${PLUGIN_ID}: gate`
const ACCOUNT_EFFECT = `${PLUGIN_ID}: account desktop marker`
const MEDIA_RECORDER_EFFECT = `${PLUGIN_ID}: media recorder mime default`
const ROUTES_EFFECT = `${PLUGIN_ID}: routes`

const ACCOUNT_MARKER_SCRIPT = `
if (new URLSearchParams(location.search).has('dshDesktop')) {
  globalThis.dshDesktop = { protocolVersion: 1, deviceInfo: async () => navigator.userAgent };
  if (globalThis.parent && globalThis.parent !== globalThis) {
    globalThis.dshDesktop.restartSidecar = () => globalThis.parent.postMessage({ type: 'dsh://tauri:invoke', cmd: 'restart_harness' }, '*');
  }
}`

export function apply(ctx: HostContext): void {
  ctx.effect(() => gate.attach(ctx as unknown as ConnectionHost), GATE_EFFECT)
  ctx.effect(() => server(ctx), ROUTES_EFFECT)
  if (process.env.DSH_TAURI_EMBEDDED === '1') {
    ctx.on('system-prompt/assemble', desktopIdentity)
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: ACCOUNT_MARKER_SCRIPT })
    }), ACCOUNT_EFFECT)
    ctx.effect(() => ctx.on('webserver/index-inject', (table) => {
      table.push({ kind: 'script', placement: 'head', text: MEDIA_RECORDER_SHIM_SCRIPT })
    }), MEDIA_RECORDER_EFFECT)
  }
}
