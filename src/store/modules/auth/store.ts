import type { EmployeeInfo } from '../../../../packages/dsh-tauri/src/shared/auth'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { defineStore } from 'valtio-define'

interface AuthSession {
  employeeNumber: string
  employeeName: string
  expiresAt: number
}

interface LoginQr {
  loginId: number
  authUrl: string
}

type ClaimResult = { status: 'pending' | 'expired' | 'cancelled' } | { status: 'authenticated', session: AuthSession }

let revision = 0
let claiming: Promise<void> | null = null

export const auth = defineStore({
  state: () => ({
    session: null as AuthSession | null,
    ticket: null as LoginQr | null,
    expired: false,
    logoutId: 0,
  }),
  actions: {
    async initialize() {
      if (!isTauri())
        return
      const current = revision
      const session = await invoke<AuthSession | null>('desktop_auth_session').catch(error => handleSessionError(error, current))
      if (current === revision)
        auth.session = session
    },
    completeLogout(id: number) {
      if (!Number.isSafeInteger(id) || id <= auth.logoutId)
        return
      auth.logoutId = id
      revision++
      auth.session = null
      auth.ticket = null
      auth.expired = false
    },
    async logout() {
      if (!isTauri())
        throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
      revision++
      const id = await invoke<number>('desktop_auth_logout')
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new Error('DESKTOP_AUTH_RESPONSE_INVALID')
      auth.completeLogout(id)
    },
    async employee(): Promise<EmployeeInfo> {
      if (!isTauri())
        throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
      const current = revision
      const employee = await invoke<EmployeeInfo>('desktop_auth_employee').catch(error => handleSessionError(error, current))
      if (current !== revision)
        throw new Error('DESKTOP_AUTH_SESSION_MISSING')
      return employee
    },
    async begin(platform: 'dingtalk' | 'wecom'): Promise<LoginQr | null> {
      if (!isTauri())
        throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
      const current = ++revision
      auth.ticket = null
      auth.expired = false
      const ticket = await invoke<LoginQr | null>('desktop_auth_begin', { platform })
      if (current === revision)
        auth.ticket = ticket
      return ticket
    },
    claim(): Promise<void> {
      if (claiming)
        return claiming
      const ticket = auth.ticket
      if (!isTauri() || !ticket)
        return Promise.resolve()
      const current = revision
      claiming = invoke<ClaimResult>('desktop_auth_claim', { loginId: ticket.loginId }).then((result) => {
        if (current !== revision)
          return
        if (result.status === 'authenticated') {
          auth.session = result.session
          auth.ticket = null
        }
        if (result.status === 'expired' || result.status === 'cancelled') {
          auth.ticket = null
          auth.expired = true
        }
      }).catch((error: unknown) => {
        if (current !== revision)
          return
        auth.ticket = null
        throw error
      }).finally(() => {
        claiming = null
      })
      return claiming
    },
    async cancel() {
      revision++
      auth.ticket = null
      auth.expired = false
      if (isTauri())
        await invoke('desktop_auth_cancel')
    },
    async request<T>(path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown } = {}): Promise<T> {
      if (!isTauri())
        throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
      return invoke<T>('desktop_auth_request', {
        method: options.method ?? 'GET',
        path,
        body: options.body ?? null,
      }).catch(handleSessionError)
    },
    async accessToken(): Promise<string> {
      if (!isTauri())
        throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
      return invoke<string>('desktop_auth_access_token').catch(handleSessionError)
    },
  },
})

function handleSessionError(error: unknown, current = revision): never {
  const message = String(error)
  if (current === revision && (message === 'DESKTOP_AUTH_SESSION_MISSING' || message.startsWith('DESKTOP_AUTH_VAULT_')))
    auth.session = null
  throw error
}
