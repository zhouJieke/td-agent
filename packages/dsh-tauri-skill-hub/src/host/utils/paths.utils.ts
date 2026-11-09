import { join } from 'node:path'
import { SKILL_FILE_NAME, SKILLS_DATA_DIR } from '../config/constants'

const REPOS_DIRECTORY = 'repos'

export function skillDir(name: string): string {
  return join(SKILLS_DATA_DIR, name)
}

export function skillFilePath(name: string): string {
  return join(skillDir(name), SKILL_FILE_NAME)
}

export function materialDirFor(entryId: string): string {
  return join(SKILLS_DATA_DIR, REPOS_DIRECTORY, entryId)
}
