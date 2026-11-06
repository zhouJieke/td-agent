export type LocalSkillStatus = 'ready' | 'pending' | 'shadowed' | 'not-invocable' | 'unavailable'

export interface LocalSkillDefinition {
  source?: string
  invocation?: { userInvocable?: boolean }
  resourceBase?: { kind: string, path?: string }
}

export interface SkillHubHost {
  skills?: {
    get: (name: string) => Promise<LocalSkillDefinition | undefined>
  }
}
