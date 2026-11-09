import type { SkillRow, SkillSourceView } from '../../service/skills.types'

export interface ActionResult {
  ok: boolean
  name?: string
}

export interface SkillsResponse {
  skills: SkillRow[]
}

export interface SkillContentResponse {
  name: string
  content: string
}

export interface RootAddResponse {
  ok: boolean
  root: SkillSourceView
}

export interface SkillSaveBody {
  name: string
  description: string
  whenToUse?: string
  modelInvocable?: boolean
  userInvocable?: boolean
  content: string
}

export interface SkillDeleteBody {
  name: string
}

export interface SkillPolicyBody {
  name: string
  enabled: boolean
}

export interface SkillOpenBody {
  target: 'user-skills' | 'skill'
  name?: string
}

export interface RootAddBody {
  kind: 'local' | 'git'
  path?: string
  url?: string
}

export interface RootRemoveBody {
  id: string
}
