export interface GatewayGrant {
  readonly baseURL: string
  readonly api: string
  readonly displayName: string
  readonly models: readonly Record<string, unknown>[]
  readonly defaultModel: string
  readonly apiKey?: string
  readonly headers?: Record<string, string>
}

export interface GatewayProfile {
  readonly displayName: string
  readonly api: string
  readonly baseURL: string
  readonly models: readonly Record<string, unknown>[]
  readonly apiKeyEnv?: string
  readonly headers?: Record<string, string>
}

export interface GatewayCache {
  readonly source: string
  readonly fetchedAt: string
  readonly grant: GatewayGrant
}

export interface GatewayStatus {
  readonly enabled: boolean
  readonly provisioned: boolean
  readonly models: number
  readonly fetchedAt?: string
  readonly error?: string
}

export interface GatewaySyncResult {
  readonly ok: boolean
  readonly applied: boolean
  readonly models: number
  readonly error?: string
}

export type GatewaySettingsOp
  = | { op: 'set', path: readonly string[], value: unknown }
    | { op: 'unset', path: readonly string[] }

export interface GatewaySettingsEntry {
  readonly ns: string
  readonly value?: unknown
}

export interface GatewaySettingsService {
  get: (ns: string) => unknown
  describe?: () => readonly GatewaySettingsEntry[]
  mutate: (ns: string, ops: readonly GatewaySettingsOp[], expectedRevision?: number) => Promise<void>
}

export interface GatewayCredentialsService {
  resolve: (ref: string) => Promise<{ value?: string } | undefined>
  set: (ref: string, value: string) => Promise<void>
}
