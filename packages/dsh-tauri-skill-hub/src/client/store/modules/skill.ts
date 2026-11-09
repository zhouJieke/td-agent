import type { EmployeeInfo } from 'dsh-tauri/client'
import type { EmployeeDeptVO, EmployeeProfile, SkillSummary, SkillTab, UserSkillDetails } from '../../types'
import type { SkillHubState, SkillInstallStatus } from './skill.types'
import { defineStore } from 'dsh-tauri/client'

export const skill = defineStore({
  state: (): SkillHubState => ({
    employee: null,
    authChecked: false,
    authRequestId: 0,
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
    downloading: [],
    installedNames: [],
    installedVersions: {},
    updatableNames: [],
    installedChecked: false,
    installedLoading: false,
    installedRequestId: 0,
    installedError: '',
    error: '',
    feedback: null,
    feedbackSeq: 0,
  }),
  actions: {
    setEmployee(employee: EmployeeInfo | null) {
      this.authRequestId += 1
      this.employee = employee
      this.authChecked = true
    },
    startAuth(): number {
      this.authRequestId += 1
      this.authChecked = false
      return this.authRequestId
    },
    finishAuth(requestId: number, employee: EmployeeInfo | null): boolean {
      if (requestId !== this.authRequestId)
        return false
      this.employee = employee
      this.authChecked = true
      return true
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
      if (this.tab !== tab) {
        this.authRequestId += 1
        this.authChecked = false
      }
      this.tab = tab
      this.keyword = ''
    },
    setKeyword(keyword: string) {
      this.keyword = keyword
    },
    setLoading(loading: boolean) {
      this.loading = loading
    },
    startDownload(name: string) {
      this.downloading = [...this.downloading, name]
    },
    finishDownload(name: string) {
      this.downloading = this.downloading.filter(item => item !== name)
    },
    startInstalledLoad(): number {
      this.installedRequestId += 1
      this.installedLoading = true
      this.installedError = ''
      return this.installedRequestId
    },
    finishInstalledLoad(requestId: number, names: readonly string[], versions: Readonly<Record<string, string>> = {}, updatableNames: readonly string[] = []) {
      if (requestId !== this.installedRequestId)
        return
      this.installedNames = names
      this.installedVersions = versions
      this.updatableNames = updatableNames
      this.installedChecked = true
      this.installedLoading = false
    },
    failInstalledLoad(requestId: number, error: string) {
      if (requestId !== this.installedRequestId)
        return
      this.installedChecked = false
      this.installedLoading = false
      this.installedError = error
    },
    markInstalled(name: string, version?: string) {
      this.installedRequestId += 1
      this.installedLoading = false
      if (!this.installedNames.includes(name))
        this.installedNames = [...this.installedNames, name]
      if (!this.updatableNames.includes(name))
        this.updatableNames = [...this.updatableNames, name]
      if (version !== undefined)
        this.installedVersions = { ...this.installedVersions, [name]: version }
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
    notifyDownloaded(skillName: string, status: SkillInstallStatus, detail?: string) {
      this.feedbackSeq += 1
      this.feedback = {
        seq: this.feedbackSeq,
        kind: 'downloaded',
        skillName,
        status,
        ...(detail === undefined ? {} : { detail }),
      }
    },
    notifyUpdated(skillName: string, status: SkillInstallStatus, detail?: string) {
      this.feedbackSeq += 1
      this.feedback = {
        seq: this.feedbackSeq,
        kind: 'updated',
        skillName,
        status,
        ...(detail === undefined ? {} : { detail }),
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
