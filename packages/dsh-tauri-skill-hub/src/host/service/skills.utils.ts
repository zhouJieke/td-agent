import type { SkillInput, SkillSourceEntry, SkillSourceView } from './skills.types'
import { Buffer } from 'node:buffer'
import { lstatSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isEmpty } from 'lodash-es'
import { isMap, parseDocument } from 'yaml'
import { SKILL_NAME_RE, SKILLS_DATA_DIR } from '../config/constants'
import { directoryExists } from '../utils/filesystem.utils'
import { materialDirFor } from '../utils/paths.utils'

const SKILL_DESCRIPTION_MAX_LENGTH = 1024

const SKILL_WHEN_TO_USE_MAX_LENGTH = 2048

const SKILL_CONTENT_MAX_BYTES = 256 * 1024

export function rootView(entry: SkillSourceEntry): SkillSourceView {
  return { ...entry, live: entry.roots.every(root => directoryExists(root)) }
}

export function isSkillSourceEntry(entry: unknown): entry is SkillSourceEntry {
  if (typeof entry !== 'object' || entry === null)
    return false
  const candidate = entry as Record<string, unknown>
  return typeof candidate.id === 'string'
    && (candidate.kind === 'local' || candidate.kind === 'git')
    && typeof candidate.label === 'string'
    && Array.isArray(candidate.roots)
    && candidate.roots.every(root => typeof root === 'string')
    && typeof candidate.addedAt === 'number'
}

export function isOwnedMaterialDir(entryId: string, materialDir: string): boolean {
  if (typeof entryId !== 'string' || typeof materialDir !== 'string')
    return false
  const expected = materialDirFor(entryId)
  if (dirname(resolve(expected)) !== resolve(SKILLS_DATA_DIR, 'repos'))
    return false
  if (resolve(materialDir) !== resolve(expected))
    return false
  return [SKILLS_DATA_DIR, dirname(expected), expected].every(dir => !isLinkLike(dir))
}

function isLinkLike(path: string): boolean {
  const stats = lstatSync(path, { throwIfNoEntry: false })
  return stats !== undefined && stats.isSymbolicLink()
}

export function serializeSkill(input: SkillInput): string {
  const lines = [
    `name: ${input.name}`,
    `description: ${JSON.stringify(input.description)}`,
  ]
  if (!isEmpty(input.whenToUse))
    lines.push(`whenToUse: ${JSON.stringify(input.whenToUse)}`)
  if (!input.modelInvocable)
    lines.push('disable-model-invocation: true')
  if (!input.userInvocable)
    lines.push('user-invocable: false')
  const body = input.content.replace(/\r\n/g, '\n').trim()
  return `---\n${lines.join('\n')}\n---\n\n${body}\n`
}

export function validateSkillInput(input: SkillInput): string | null {
  if (!SKILL_NAME_RE.test(input.name))
    return 'name must be kebab-case (a-z, 0-9, dashes)'
  if (input.description.trim() === '')
    return 'description is required'
  if (input.description.length > SKILL_DESCRIPTION_MAX_LENGTH)
    return `description too long (max ${SKILL_DESCRIPTION_MAX_LENGTH})`
  if ((input.whenToUse?.length ?? 0) > SKILL_WHEN_TO_USE_MAX_LENGTH)
    return `whenToUse too long (max ${SKILL_WHEN_TO_USE_MAX_LENGTH})`
  if (Buffer.byteLength(input.content, 'utf8') > SKILL_CONTENT_MAX_BYTES)
    return 'content too large (max 256 KiB)'
  return null
}

export function rewriteSkillContent(text: string, input: SkillInput): string {
  const { newline, document } = frontmatterOf(text)
  document.set('name', input.name)
  document.set('description', input.description)
  if (!isEmpty(input.whenToUse))
    document.set('whenToUse', input.whenToUse)
  else
    document.delete('whenToUse')
  if (!input.modelInvocable)
    document.set('disable-model-invocation', true)
  else
    document.delete('disable-model-invocation')
  if (!input.userInvocable)
    document.set('user-invocable', false)
  else
    document.delete('user-invocable')
  const body = input.content.replace(/\r\n/g, '\n').trim()
  const head = document.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, newline)
  return `---${newline}${head}${newline}---${newline}${newline}${body.replace(/\n/g, newline)}${newline}`
}

export function rewriteSkillPolicy(text: string, enabled: boolean): string {
  const { newline, document, body } = frontmatterOf(text)
  if (enabled) {
    document.delete('disable-model-invocation')
    document.delete('user-invocable')
  }
  else {
    document.set('disable-model-invocation', true)
    document.set('user-invocable', false)
  }
  const head = document.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, newline)
  return `---${newline}${head}${newline}---${body}`
}

function frontmatterOf(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null)
    throw new Error('skill file has no frontmatter block')
  const document = parseDocument(match[1])
  if (document.errors.length > 0 || !isMap(document.contents))
    throw new Error('skill file has invalid YAML frontmatter')
  return {
    newline: text.includes('\r\n---') ? '\r\n' : '\n',
    document,
    body: text.slice(match[0].length),
  }
}
