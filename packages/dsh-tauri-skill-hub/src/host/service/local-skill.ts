import type { HostContext } from 'dsh-tauri'
import type { LocalSkillStatus, SkillHubHost } from './local-skill.types'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { getServerContext } from 'dsh-h3/utils'
import { defineService, DSH_HOME } from 'dsh-tauri'
import { server } from '../server'

const WAIT_MS = 5_000
const INTERVAL_MS = 250

export const localSkill = defineService({
  async get(name: string): Promise<{ status: LocalSkillStatus }> {
    const registry = getServerContext<HostContext & SkillHubHost>(server).get('skills')
    if (typeof registry?.get !== 'function')
      return { status: 'unavailable' }

    const deadline = Date.now() + WAIT_MS
    while (true) {
      const skill = await registry.get(name)
      if (skill !== undefined) {
        const path = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined
        if (skill.source !== 'user-dsh' || typeof path !== 'string')
          return { status: 'shadowed' }
        const [expected, actual] = await Promise.all([
          realpath(join(DSH_HOME, 'skills', name)),
          realpath(path),
        ])
        if (expected !== actual)
          return { status: 'shadowed' }
        if (typeof skill.invocation?.userInvocable !== 'boolean')
          return { status: 'unavailable' }
        return { status: skill.invocation.userInvocable ? 'ready' : 'not-invocable' }
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0)
        return { status: 'pending' }
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(INTERVAL_MS, remaining)))
    }
  },
})
