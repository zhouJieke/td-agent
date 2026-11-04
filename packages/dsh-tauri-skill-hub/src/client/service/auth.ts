import type { EmployeeInfo } from 'dsh-tauri/client'
import { invoke } from 'dsh-tauri/client'
import { store } from '../store'

/**
 * Query：探测当前登录态。已登录则把员工身份写入 store；
 * 未登录或探测失败一律记为 `null`，由面板渲染登录提示。
 */
export async function fetchAuth(): Promise<void> {
  try {
    store.skill.setEmployee(await invoke<EmployeeInfo>('desktop_auth_employee'))
  }
  catch {
    store.skill.setEmployee(null)
  }
}
