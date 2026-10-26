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
  }),
  actions: {
    async initialize() {
      if (!isTauri())
        return
      auth.session = await invoke<AuthSession | null>('desktop_auth_session').catch(handleSessionError)
    },
    async begin() {
      if (!isTauri())
        throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
      const current = ++revision
      auth.ticket = null
      auth.expired = false
      const ticket = await invoke<LoginQr | null>('desktop_auth_begin')
      if (current === revision)
        auth.ticket = ticket
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

function handleSessionError(error: unknown): never {
  const message = String(error)
  if (message === 'DESKTOP_AUTH_SESSION_MISSING' || message.startsWith('DESKTOP_AUTH_VAULT_'))
    auth.session = null
  throw error
}
