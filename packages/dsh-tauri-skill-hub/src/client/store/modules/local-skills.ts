import type { SkillRowView } from '../../types'
import type { LocalSkillsState, SkillEditorState } from './local-skills.types'
import { defineStore } from 'dsh-tauri/client'

export const localSkills = defineStore({
  state: (): LocalSkillsState => ({
    skills: null,
    loading: false,
    requestId: 0,
    busy: false,
    error: '',
    formError: '',
    editor: null,
    preview: false,
    confirmName: null,
    query: '',
    importOpen: false,
    repositoryUrl: '',
  }),
  actions: {
    startLoad(): number {
      this.requestId += 1
      this.loading = true
      this.error = ''
      return this.requestId
    },
    finishLoad(requestId: number, skills: SkillRowView[]) {
      if (requestId !== this.requestId)
        return
      this.skills = skills
      this.loading = false
    },
    failLoad(requestId: number, error: string) {
      if (requestId !== this.requestId)
        return
      this.error = error
      this.loading = false
    },
    setBusy(busy: boolean) {
      this.busy = busy
    },
    setError(error: string) {
      this.error = error
    },
    setFormError(error: string) {
      this.formError = error
    },
    setEditor(editor: SkillEditorState | null) {
      this.editor = editor
      this.formError = ''
    },
    setPreview(preview: boolean) {
      this.preview = preview
    },
    setConfirmName(name: string | null) {
      this.confirmName = name
    },
    setQuery(query: string) {
      this.query = query
    },
    setImportOpen(open: boolean) {
      this.importOpen = open
      this.formError = ''
    },
    setRepositoryUrl(url: string) {
      this.repositoryUrl = url
    },
    reset() {
      this.skills = null
      this.loading = false
      this.requestId += 1
      this.busy = false
      this.error = ''
      this.formError = ''
      this.editor = null
      this.preview = false
      this.confirmName = null
      this.query = ''
      this.importOpen = false
      this.repositoryUrl = ''
    },
  },
})
