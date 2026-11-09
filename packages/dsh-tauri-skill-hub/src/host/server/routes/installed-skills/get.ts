import type { InstalledSkills } from '../../../service/skills.types'
import { defineEventHandler } from 'h3'
import { skills } from '../../../service/skills'

export default defineEventHandler(async (event): Promise<InstalledSkills | { error: string }> => {
  try {
    return await skills.listInstalled()
  }
  catch (error) {
    event.res.status = 500
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
