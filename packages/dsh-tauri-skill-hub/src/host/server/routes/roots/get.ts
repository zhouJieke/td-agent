import type { EventHandlerRequest } from 'h3'
import type { SkillSourceView } from '../../../service/skills.types'
import { defineEventHandler } from 'h3'
import { skills } from '../../../service/skills'
import { rootView } from '../../../service/skills.utils'

export default defineEventHandler<EventHandlerRequest, Promise<{ roots: SkillSourceView[] } | { error: string }>>(async (event) => {
  try {
    return { roots: (await skills.listSources()).map(rootView) }
  }
  catch (error) {
    event.res.status = 500
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
