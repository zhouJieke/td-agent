import { defineEventHandler } from 'h3'
import { skills } from '../../../service/skills'

export default defineEventHandler(async (event): Promise<{ names: string[] } | { error: string }> => {
  try {
    return { names: await skills.listInstalled() }
  }
  catch (error) {
    event.res.status = 500
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
