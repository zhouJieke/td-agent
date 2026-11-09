import type { EventHandlerRequest } from 'h3'
import type { SkillInput } from '../../../service/skills.types'
import type { ActionResult, SkillSaveBody } from '../index.types'
import { dirname, resolve } from 'node:path'
import { defineEventHandler, readBody } from 'h3'
import { provider } from '../../../service/provider'
import { skills } from '../../../service/skills'
import { validateSkillInput } from '../../../service/skills.utils'

export default defineEventHandler<EventHandlerRequest, Promise<ActionResult | { error: string }>>(async (event) => {
  const body = await readBody<SkillSaveBody>(event, { type: 'json' })
  const input: SkillInput = {
    name: typeof body?.name === 'string' ? body.name : '',
    description: typeof body?.description === 'string' ? body.description : '',
    whenToUse: typeof body?.whenToUse === 'string' ? body.whenToUse : undefined,
    modelInvocable: body?.modelInvocable !== false,
    userInvocable: body?.userInvocable !== false,
    content: typeof body?.content === 'string' ? body.content : '',
  }
  try {
    const invalid = validateSkillInput(input)
    if (invalid !== null) {
      event.res.status = 400
      return { error: invalid }
    }
    await provider.sync()
    const existing = (await skills.getCatalog()).find(skill => skill.name === input.name)
    if (existing !== undefined) {
      if (existing.dir === undefined || !existing.editable) {
        event.res.status = 403
        return { error: `skills from source '${existing.source}' are read-only` }
      }
      const definition = await skills.get(input.name)
      if (definition?.path === undefined || resolve(dirname(definition.path)) !== resolve(existing.dir)) {
        event.res.status = 422
        return { error: 'skill file is not available in its resource directory' }
      }
      skills.save(input, definition.path)
    }
    else {
      skills.save(input)
    }
    await provider.refresh()
    return { ok: true, name: input.name }
  }
  catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      event.res.status = 409
      return { error: 'skill file already exists' }
    }
    event.res.status = 500
    return { error: error instanceof Error ? error.message : String(error) }
  }
})
