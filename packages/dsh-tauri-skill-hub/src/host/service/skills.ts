import type { HostContext } from 'dsh-tauri'
import type {
  HostSkill,
  HostSkillDefinition,
  InstalledSkills,
  PluginState,
  SkillInput,
  SkillRepositoryMetadata,
  SkillRow,
  SkillSourceEntry,
  SkillsService,
} from './skills.types'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getServerContext } from 'dsh-h3/utils'
import { defineService } from 'dsh-tauri'
import { orderBy } from 'lodash-es'
import { parse as parseVersion } from 'semver'
import { SKILL_FILE_NAME, SKILL_NAME_RE, SKILLS_DATA_DIR } from '../config/constants'
import { server } from '../server'
import { storage } from '../storage'
import { skillDir, skillFilePath } from '../utils/paths.utils'
import { rmtree } from './rmtree'
import { isOwnedMaterialDir, isSkillSourceEntry, rewriteSkillContent, rewriteSkillPolicy, serializeSkill } from './skills.utils'

const STATE_FILE_NAME = 'state.json'
const SKILL_VERSION_FILE_NAME = '.dsh-tauri-skill-version.json'
const MAX_VERSION_FILE_BYTES = 4096

export const skills = defineService({
  async get(name: string): Promise<HostSkillDefinition | null> {
    return (await registry().get(name)) ?? null
  },

  save(input: SkillInput, file?: string): string {
    if (file !== undefined) {
      writeFileSync(file, rewriteSkillContent(readFileSync(file, 'utf8'), input), 'utf8')
      return file
    }
    const target = skillFilePath(input.name)
    mkdirSync(skillDir(input.name), { recursive: true })
    if (lstatSync(skillDir(input.name)).isSymbolicLink())
      throw new Error('cannot create a skill in a linked directory')
    writeFileSync(target, serializeSkill(input), { encoding: 'utf8', flag: 'wx' })
    return target
  },

  async remove(name: string): Promise<boolean> {
    if (!SKILL_NAME_RE.test(name))
      return false
    const skill = await registry().get(name)
    if (skill?.source !== 'user-dsh' || skill.path === undefined)
      return false
    const file = resolve(skill.path)
    const parts = relative(resolve(SKILLS_DATA_DIR), file).split(sep)
    if (parts.length === 1 && parts[0].endsWith('.md') && parts[0] !== '..') {
      rmSync(file)
      return true
    }
    if (parts.length !== 2 || parts[0] === '..' || parts[1] !== SKILL_FILE_NAME)
      throw new Error(`unsafe user skill path: ${file}`)
    const dir = resolve(SKILLS_DATA_DIR, parts[0])
    if (lstatSync(dir).isSymbolicLink())
      throw new Error(`cannot remove a linked skill directory: ${dir}`)
    rmSync(dir, { recursive: true })
    return true
  },

  async getCatalog(): Promise<SkillRow[]> {
    const [hostSkills, sources] = await Promise.all([registry().list(), readSources()])
    const rows = await Promise.all(hostSkills.map(async skill => toSkillRow(skill, sources, await isEnterpriseSkill(skill))))
    return orderBy(rows, [row => row.repository === undefined], ['asc'])
  },

  async listInstalled(): Promise<InstalledSkills> {
    let entries
    try {
      entries = await readdir(SKILLS_DATA_DIR, { withFileTypes: true })
    }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { names: [], versions: {}, updatableNames: [] }
      throw error
    }
    const root = await lstat(SKILLS_DATA_DIR)
    const rootSafe = root.isDirectory() && !root.isSymbolicLink()
    const candidates = await Promise.all(entries.map(async (entry) => {
      const filename = entry.name.toLowerCase()
      if (filename.endsWith('.md')) {
        const name = filename.slice(0, -3)
        if (name.length <= 64 && SKILL_NAME_RE.test(name)
          && (entry.isFile() || entry.isSymbolicLink())
          && await isFile(join(SKILLS_DATA_DIR, `${name}.md`))) {
          return { name, flat: true, updatable: false }
        }
      }
      if (filename.length <= 64 && SKILL_NAME_RE.test(filename)
        && (entry.isDirectory() || entry.isSymbolicLink())
        && await isFile(join(SKILLS_DATA_DIR, filename, SKILL_FILE_NAME))) {
        const updatable = rootSafe && entry.isDirectory() && await isRegularFile(join(SKILLS_DATA_DIR, filename, SKILL_FILE_NAME))
        return { name: filename, flat: false, updatable }
      }
      return undefined
    }))
    const found = candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
    const names = [...new Set(found.map(candidate => candidate.name))].sort()
    const flatNames = new Set(found.filter(candidate => candidate.flat).map(candidate => candidate.name))
    const updatableNames = [...new Set(found.filter(candidate => candidate.updatable && !flatNames.has(candidate.name)).map(candidate => candidate.name))].sort()
    const versions: Record<string, string> = {}
    for (const name of updatableNames) {
      const version = await installedVersion(name)
      if (version !== undefined)
        versions[name] = version
    }
    return { names, versions, updatableNames }
  },

  async listSources(): Promise<SkillSourceEntry[]> {
    return readSources()
  },

  async getSource(url: string): Promise<SkillSourceEntry | null> {
    return (await readSources()).find(entry => entry.url === url) ?? null
  },

  async saveSource(entry: Omit<SkillSourceEntry, 'addedAt'>): Promise<SkillSourceEntry> {
    const sources = await readSources()
    const stored: SkillSourceEntry = { ...entry, addedAt: Date.now() }
    sources.push(stored)
    await writeSources(sources)
    return stored
  },

  async removeSource(id: string): Promise<SkillSourceEntry | null> {
    const sources = await readSources()
    const at = sources.findIndex(entry => entry.id === id)
    if (at === -1)
      return null
    const removed = sources[at]
    if (removed.materialDir !== undefined) {
      if (!isOwnedMaterialDir(removed.id, removed.materialDir))
        throw new Error(`unsafe skill material directory: ${removed.materialDir}`)
      rmtree.remove(removed.materialDir)
    }
    sources.splice(at, 1)
    await writeSources(sources)
    return removed
  },

  setPolicy(file: string, enabled: boolean): void {
    writeFileSync(file, rewriteSkillPolicy(readFileSync(file, 'utf8'), enabled), 'utf8')
  },
})

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
      return false
    throw error
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile()
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR'))
      return false
    throw error
  }
}

async function installedVersion(name: string): Promise<string | undefined> {
  const file = join(SKILLS_DATA_DIR, name, SKILL_VERSION_FILE_NAME)
  let info
  try {
    info = await lstat(file)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined
    throw error
  }
  if (!info.isFile() || info.size > MAX_VERSION_FILE_BYTES)
    throw new Error(`SKILL_VERSION_METADATA_INVALID: ${name}`)
  let value: unknown
  try {
    value = JSON.parse(await readFile(file, 'utf8'))
  }
  catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`SKILL_VERSION_METADATA_INVALID: ${name}`)
    throw error
  }
  if (typeof value !== 'object' || value === null || !('source' in value) || value.source !== 'nacos'
    || !('version' in value) || typeof value.version !== 'string' || !/^\d/.test(value.version)
    || parseVersion(value.version) === null) {
    throw new Error(`SKILL_VERSION_METADATA_INVALID: ${name}`)
  }
  return value.version
}

function registry(): SkillsService {
  const service: unknown = getServerContext<HostContext>(server).get('skills')
  if (typeof service !== 'object' || service === null || !('list' in service) || !('get' in service)
    || typeof service.list !== 'function' || typeof service.get !== 'function') {
    throw new Error('DSH skill service is unavailable')
  }
  return service as SkillsService
}

async function readSources(): Promise<SkillSourceEntry[]> {
  const parsed = await storage.getItem<Partial<PluginState>>(STATE_FILE_NAME)
  if (parsed === null)
    return []
  if (typeof parsed !== 'object')
    throw new Error('Invalid skill repository state')
  if (parsed.skillRoots === undefined)
    return []
  if (!Array.isArray(parsed.skillRoots))
    throw new Error('Invalid skill repository state')
  const entries = parsed.skillRoots.filter(isSkillSourceEntry)
  if (entries.length !== parsed.skillRoots.length)
    getServerContext<HostContext>(server).logger.warn('skill-hub: ignored invalid skill repository entries')
  return entries
}

async function writeSources(sources: SkillSourceEntry[]): Promise<void> {
  await storage.setItem(STATE_FILE_NAME, `${JSON.stringify({ skillRoots: sources }, null, 2)}\n`)
}

function pathWithin(path: string, parent: string): boolean {
  const nested = relative(resolve(parent), resolve(path))
  return nested === '' || (!nested.startsWith(`..${sep}`) && nested !== '..' && !isAbsolute(nested))
}

function repositoryForSkill(skill: HostSkill, entries: SkillSourceEntry[]): SkillRepositoryMetadata | undefined {
  const dir = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined
  if (dir === undefined)
    return undefined
  const entry = entries.find(candidate => candidate.roots.some(root => pathWithin(dir, root)))
  if (entry === undefined)
    return undefined
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    ...(entry.kind === 'git' && entry.url !== undefined ? { githubUrl: entry.url } : {}),
  }
}

async function isEnterpriseSkill(skill: HostSkill): Promise<boolean> {
  return skill.source === 'user-dsh' && await installedVersion(skill.name) !== undefined
}

function toSkillRow(skill: HostSkill, entries: SkillSourceEntry[], enterprise: boolean): SkillRow {
  const dir = skill.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined
  const repository = repositoryForSkill(skill, entries)
  const editable = dir !== undefined && (
    skill.source === 'user-dsh'
    || (skill.source === 'custom' && (
      pathWithin(dir, SKILLS_DATA_DIR) || entries.some(entry => entry.roots.some(root => pathWithin(dir, root)))
    ))
  )
  return {
    ...skill,
    ...(enterprise ? { source: 'enterprise' } : {}),
    editable,
    removable: skill.source === 'user-dsh' && dir !== undefined && existsSync(dir),
    ...(dir !== undefined ? { dir } : {}),
    policyEditable: dir !== undefined,
    ...(repository !== undefined ? { repository } : {}),
  }
}
