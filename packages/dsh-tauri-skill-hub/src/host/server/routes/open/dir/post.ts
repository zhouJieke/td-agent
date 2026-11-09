import type { EventHandlerRequest } from 'h3'
import type { ActionResult, SkillOpenBody } from '../../index.types'
import { defineEventHandler, readBody } from 'h3'
import { opener } from '../../../../service/opener'

export default defineEventHandler<EventHandlerRequest, Promise<ActionResult | { error: string }>>(async (event) => {
  const body = await readBody<SkillOpenBody>(event, { type: 'json' })
  if (body?.target !== 'user-skills' && body?.target !== 'skill') {
    event.res.status = 400
    return { error: 'unknown target' }
  }
  if (body.target === 'skill' && typeof body.name !== 'string') {
    event.res.status = 400
    return { error: 'name is required' }
  }
  try {
    if (!await opener.open(body.target, body.name)) {
      event.res.status = 404
      return { error: 'skill directory not found' }
    }
    return { ok: true }
  }
  catch (error) {
    event.res.status = 500
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
