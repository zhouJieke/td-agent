import type { SkillRowView } from '../../types'

export interface SkillEditorState {
  mode: 'edit' | 'view'
  name: string
  description: string
  whenToUse: string
  modelInvocable: boolean
  userInvocable: boolean
  content: string
}

export interface LocalSkillsState {
  skills: SkillRowView[] | null
  loading: boolean
  requestId: number
  busy: boolean
  error: string
  formError: string
  editor: SkillEditorState | null
  preview: boolean
  confirmName: string | null
  query: string
  sourceFilter: string
  importOpen: boolean
  repositoryUrl: string
}
