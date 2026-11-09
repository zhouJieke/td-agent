import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { defineService, openDirectory } from 'dsh-tauri'
import { SKILLS_DATA_DIR } from '../config/constants'
import { provider } from './provider'
import { skills } from './skills'

export const opener = defineService({
  async open(target: 'user-skills' | 'skill', name?: string): Promise<boolean> {
    if (target === 'user-skills') {
      mkdirSync(SKILLS_DATA_DIR, { recursive: true })
      await openDirectory(SKILLS_DATA_DIR)
      return true
    }
    if (name === undefined)
      return false
    await provider.sync()
    const skill = await skills.get(name)
    const dir = skill?.path === undefined
      ? skill?.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined
      : dirname(skill.path)
    if (dir === undefined)
      return false
    await openDirectory(dir)
    return true
  },
})
