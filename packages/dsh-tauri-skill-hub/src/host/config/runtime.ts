import type { HostContext } from 'dsh-tauri'

export const providerRuntime: {
  fiber?: ReturnType<HostContext['plugin']>
  chain: Promise<void>
  signature?: string
  stopWatching?: () => void
  disposed: boolean
  generation: number
  epoch: number
} = {
  chain: Promise.resolve(),
  disposed: true,
  generation: 0,
  epoch: 0,
}
