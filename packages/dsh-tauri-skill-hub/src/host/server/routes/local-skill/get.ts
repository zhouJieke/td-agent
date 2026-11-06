import type { LocalSkillStatus } from '../../../service/local-skill.types'
import { defineEventHandler, getQuery } from 'h3'
import { localSkill } from '../../../service/local-skill'

export default defineEventHandler(async (event): Promise<{ status: LocalSkillStatus } | { error: string }> => {
  const { name } = getQuery<{ name?: string }>(event)
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    event.res.status = 400
    return { error: 'SKILL_NAME_INVALID' }
  }
  try {
    return await localSkill.get(name)
  }
  catch (error) {
    event.res.status = 500
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
