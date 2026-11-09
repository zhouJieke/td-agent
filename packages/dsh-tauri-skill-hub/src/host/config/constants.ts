import { join } from 'node:path'
import { DSH_HOME } from 'dsh-tauri'

export const SKILL_FILE_NAME = 'SKILL.md'
export const SKILLS_DATA_DIR = join(DSH_HOME, 'skills')

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
