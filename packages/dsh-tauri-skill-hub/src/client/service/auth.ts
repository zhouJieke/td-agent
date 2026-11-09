import type { EmployeeInfo } from 'dsh-tauri/client'
import { invoke } from 'dsh-tauri/client'
import { store } from '../store'

/**
 * Query：探测当前登录态。已登录则把员工身份写入 store；
 * 未登录或探测失败一律记为 `null`，由面板渲染登录提示。
 */
export async function fetchAuth(): Promise<boolean> {
  const requestId = store.skill.startAuth()
  try {
    return store.skill.finishAuth(requestId, await invoke<EmployeeInfo>('desktop_auth_employee'))
  }
  catch {
    return store.skill.finishAuth(requestId, null)
  }
}
