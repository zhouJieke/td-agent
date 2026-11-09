import type { SkillRowView } from '../types'
import { deleteSkill, getSkill, getSkills, postOpenDir, postRoots, postSkill, postSkillPolicy, postSkillsRefresh } from '../apis'
import { locale } from '../locales'
import { store } from '../store'
import { fetchInstalledSkills } from './skill'

const GITHUB_REPOSITORY_PATTERN = /^(?:https?:\/\/github\.com\/)?[\w.-]+\/[\w.-]+\/?$/i

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertAction(result: { ok: boolean } | { error: string }): void {
  if ('error' in result)
    throw new Error(result.error)
  if (!result.ok)
    throw new Error('Operation did not complete')
}

export async function fetchLocalSkills(options?: { refresh?: boolean }): Promise<void> {
  const requestId = store.localSkills.startLoad()
  try {
    const result = options?.refresh ? await postSkillsRefresh() : await getSkills()
    if ('error' in result)
      throw new Error(result.error)
    store.localSkills.finishLoad(requestId, result.skills)
  }
  catch (error) {
    store.localSkills.failLoad(requestId, messageOf(error))
  }
}

export async function refreshLocalSkills(): Promise<void> {
  store.localSkills.setBusy(true)
  try {
    await fetchLocalSkills({ refresh: true })
  }
  finally {
    store.localSkills.setBusy(false)
  }
}

export async function openLocalSkill(skill: SkillRowView): Promise<void> {
  store.localSkills.setBusy(true)
  store.localSkills.setError('')
  try {
    const result = await getSkill({ name: skill.name })
    if ('error' in result)
      throw new Error(result.error)
    store.localSkills.setPreview(!skill.editable)
    store.localSkills.setEditor({
      mode: skill.editable ? 'edit' : 'view',
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse ?? '',
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
      content: result.content,
    })
  }
  catch (error) {
    store.localSkills.setError(messageOf(error))
  }
  finally {
    store.localSkills.setBusy(false)
  }
}

export async function saveLocalSkill(): Promise<void> {
  const editor = store.localSkills.editor
  if (editor === null)
    return
  store.localSkills.setBusy(true)
  store.localSkills.setFormError('')
  try {
    assertAction(await postSkill({
      name: editor.name.trim(),
      description: editor.description,
      whenToUse: editor.whenToUse.trim() || undefined,
      modelInvocable: editor.modelInvocable,
      userInvocable: editor.userInvocable,
      content: editor.content,
    }))
    store.localSkills.setEditor(null)
    await fetchLocalSkills()
  }
  catch (error) {
    store.localSkills.setFormError(messageOf(error))
  }
  finally {
    store.localSkills.setBusy(false)
  }
}

export async function deleteLocalSkill(): Promise<void> {
  const name = store.localSkills.confirmName
  if (name === null)
    return
  store.localSkills.setBusy(true)
  store.localSkills.setFormError('')
  try {
    assertAction(await deleteSkill({ name }))
    store.localSkills.setConfirmName(null)
    await Promise.all([fetchLocalSkills(), fetchInstalledSkills()])
  }
  catch (error) {
    store.localSkills.setFormError(messageOf(error))
    await fetchInstalledSkills()
  }
  finally {
    store.localSkills.setBusy(false)
  }
}

export async function toggleLocalSkill(skill: SkillRowView): Promise<void> {
  const enabled = skill.invocation.modelInvocable || skill.invocation.userInvocable
  store.localSkills.setBusy(true)
  store.localSkills.setError('')
  try {
    assertAction(await postSkillPolicy({ name: skill.name, enabled: !enabled }))
    await fetchLocalSkills()
  }
  catch (error) {
    store.localSkills.setError(messageOf(error))
  }
  finally {
    store.localSkills.setBusy(false)
  }
}

export async function openLocalSkillDirectory(target: { target: 'user-skills' } | { target: 'skill', name: string }): Promise<void> {
  store.localSkills.setError('')
  try {
    assertAction(await postOpenDir(target))
  }
  catch (error) {
    store.localSkills.setError(messageOf(error))
  }
}

export async function createLocalSkill(createSkill: () => Promise<void>): Promise<void> {
  store.localSkills.setBusy(true)
  store.localSkills.setError('')
  try {
    await createSkill()
  }
  catch (error) {
    store.localSkills.setError(`${locale.text('skillCreatorFailed')}: ${messageOf(error)}`)
  }
  finally {
    store.localSkills.setBusy(false)
  }
}

export async function importLocalRepository(): Promise<void> {
  const value = store.localSkills.repositoryUrl.trim().replace(/\/$/, '')
  if (!GITHUB_REPOSITORY_PATTERN.test(value)) {
    store.localSkills.setFormError(locale.text('importRepositoryInvalid'))
    return
  }
  const url = value.startsWith('http') ? value : `https://github.com/${value}`
  store.localSkills.setBusy(true)
  store.localSkills.setFormError('')
  try {
    assertAction(await postRoots({ kind: 'git', url }))
    store.localSkills.setImportOpen(false)
    store.localSkills.setRepositoryUrl('')
    await fetchLocalSkills()
  }
  catch (error) {
    store.localSkills.setFormError(messageOf(error))
  }
  finally {
    store.localSkills.setBusy(false)
  }
}
