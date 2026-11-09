import type { LocaleKey } from '../locales/index.types'
import type { SkillRowView } from '../types'

export function policyTag(skill: SkillRowView): { key?: LocaleKey, off: boolean } {
  const { modelInvocable, userInvocable } = skill.invocation
  if (!modelInvocable && !userInvocable)
    return { key: 'skillDisabled', off: true }
  if (!modelInvocable)
    return { key: 'skillUserOnly', off: false }
  if (!userInvocable)
    return { key: 'skillModelOnly', off: false }
  return { off: false }
}
