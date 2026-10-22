import { connection } from './index'

/**
 * 启动时恢复连接记录：
 * `connection.$persist.rehydrate()` 由 valtio-define persist 插件把 `{version, history, guidedHosts}`
 * 读回 state（AsyncStorage 适配器在 store 模块里）；
 * 最后 `markHydrated()` 才把 state 标记为可用（也是插件开始写盘的前提）。
 */
export async function restoreConnections(): Promise<void> {
  if (connection.hydrated)
    return
  await connection.$persist.rehydrate()
  connection.markHydrated()
}
