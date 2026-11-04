import type { EmployeeInfo } from 'dsh-tauri/client'
import type { EmployeeDeptVO, EmployeeProfile, SkillSummary, SkillTab, UserSkillDetails } from '../../types'
import type { SkillHubState } from './skill.types'
import { defineStore } from 'dsh-tauri/client'

export const skill = defineStore({
  state: (): SkillHubState => ({
    employee: null,
    authChecked: false,
    common: [],
    catalog: [],
    mine: null,
    profile: null,
    employees: [],
    manageUserId: '',
    manageMine: null,
    manageLoading: false,
    tab: 'enterprise',
    keyword: '',
    loading: false,
    error: '',
    feedback: null,
    feedbackSeq: 0,
  }),
  actions: {
    setEmployee(employee: EmployeeInfo | null) {
      this.employee = employee
      this.authChecked = true
    },
    setCommon(common: readonly SkillSummary[]) {
      this.common = common
    },
    setCatalog(catalog: readonly SkillSummary[]) {
      this.catalog = catalog
    },
    setMine(mine: UserSkillDetails | null) {
      this.mine = mine
    },
    setProfile(profile: EmployeeProfile | null) {
      this.profile = profile
    },
    setEmployees(employees: readonly EmployeeDeptVO[]) {
      this.employees = employees
    },
    setManageUser(manageUserId: string) {
      this.manageUserId = manageUserId
    },
    setManageMine(mine: UserSkillDetails | null) {
      this.manageMine = mine
    },
    setManageLoading(loading: boolean) {
      this.manageLoading = loading
    },
    setTab(tab: SkillTab) {
      this.tab = tab
      this.keyword = ''
    },
    setKeyword(keyword: string) {
      this.keyword = keyword
    },
    setLoading(loading: boolean) {
      this.loading = loading
    },
    setError(error: string) {
      this.error = error
      this.loading = false
    },
    notifySaved(name: string, count: number) {
      this.feedbackSeq += 1
      this.feedback = {
        seq: this.feedbackSeq,
        kind: 'saved',
        name,
        count,
      }
    },
    notifyUploaded(skillName: string, version: string) {
      this.feedbackSeq += 1
      this.feedback = {
        seq: this.feedbackSeq,
        kind: 'uploaded',
        skillName,
        version,
      }
    },
    notifyFailed(error: string) {
      this.feedbackSeq += 1
      this.feedback = {
        seq: this.feedbackSeq,
        kind: 'failed',
        error,
      }
    },
    dismissFeedback(seq?: number) {
      if (seq === undefined || this.feedback?.seq === seq)
        this.feedback = null
    },
  },
})
