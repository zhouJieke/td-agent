import type { HostContext } from 'dsh-tauri'
import { existsSync, unwatchFile, watchFile } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getServerContext } from 'dsh-h3/utils'
import { defineService, DSH_HOME } from 'dsh-tauri'
import { SKILLS_DATA_DIR } from '../config/constants'
import { providerRuntime } from '../config/runtime'
import { server } from '../server'
import { skills } from './skills'

const STATE_FILE = join(SKILLS_DATA_DIR, 'state.json')
const AGENT_SKILL_DIRS = ['.claude/skills', '.codex/skills'] as const
const WATCH_INTERVAL_MS = 1_000

export const provider = defineService({
  initialize(): () => Promise<void> {
    const epoch = ++providerRuntime.epoch
    providerRuntime.disposed = false
    providerRuntime.stopWatching?.()
    const logger = getServerContext<HostContext>(server).logger
    const reportError = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(`skill-hub: filesystem skill provider failed: ${message}`)
    }
    const onChange = (): void => {
      if (isActive(epoch))
        void enqueue(false, epoch).catch(reportError)
    }
    watchFile(STATE_FILE, { persistent: false, interval: WATCH_INTERVAL_MS }, onChange)
    const stopWatching = (): void => unwatchFile(STATE_FILE, onChange)
    providerRuntime.stopWatching = stopWatching
    void enqueue(true, epoch).catch(reportError)
    return () => {
      stopWatching()
      if (providerRuntime.epoch !== epoch)
        return Promise.resolve()
      providerRuntime.disposed = true
      providerRuntime.stopWatching = undefined
      const disposal = providerRuntime.chain.then(disposeFiber, disposeFiber)
      providerRuntime.chain = disposal
      return disposal
    }
  },

  sync(): Promise<void> {
    return schedule(false)
  },

  refresh(): Promise<void> {
    return schedule(true)
  },
})

function schedule(force: boolean): Promise<void> {
  if (providerRuntime.disposed) {
    const registry: unknown = getServerContext<HostContext>(server).get('skills')
    if (!isRegistry(registry))
      return Promise.reject(new Error('DSH skill service is unavailable'))
    return Promise.reject(new Error('DSH skill provider is not active'))
  }
  return enqueue(force, providerRuntime.epoch)
}

function enqueue(force: boolean, epoch: number): Promise<void> {
  const next = providerRuntime.chain.then(() => remount(force, epoch), () => remount(force, epoch))
  providerRuntime.chain = next
  return next
}

function isActive(epoch: number): boolean {
  return !providerRuntime.disposed && providerRuntime.epoch === epoch
}

function isRegistry(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'list' in value && 'get' in value
    && typeof value.list === 'function' && typeof value.get === 'function'
}

async function disposeFiber(): Promise<void> {
  const fiber = providerRuntime.fiber
  providerRuntime.fiber = undefined
  providerRuntime.signature = undefined
  if (fiber !== undefined)
    await fiber.dispose()
}

async function remount(force: boolean, epoch: number): Promise<void> {
  if (!isActive(epoch))
    return
  const host = getServerContext<HostContext>(server)
  const registry: unknown = host.get('skills')
  if (!isRegistry(registry))
    throw new Error('DSH skill service is unavailable')
  const loader = host.get('loader')
  if (typeof loader?.import !== 'function' || typeof loader.unwrapExports !== 'function')
    throw new Error('DSH skill provider loader is unavailable')

  const roots = [
    packagedSkillsDir(),
    ...(await skills.listSources()).flatMap(entry => entry.roots),
    ...AGENT_SKILL_DIRS.map(path => join(homedir(), path)).filter(path => existsSync(path)),
  ]
  const signature = JSON.stringify(roots)
  if (!isActive(epoch))
    return
  if (!force && providerRuntime.fiber !== undefined && providerRuntime.signature === signature)
    return

  const value = loader.unwrapExports(await loader.import('@deepseek-ai/dsh-skill-filesystem'))
  if (typeof value !== 'object' || value === null || !('apply' in value) || typeof value.apply !== 'function')
    throw new Error('Invalid DSH filesystem skill provider')
  if (!isActive(epoch))
    return
  const plugin = value as { name?: string, apply: (ctx: unknown, config?: unknown) => void }
  const next = host.plugin(plugin, {
    providerName: `skill-hub-filesystem-${++providerRuntime.generation}`,
    dshHome: DSH_HOME,
    customSkillDirs: roots,
  })
  try {
    await next.await()
  }
  catch (error) {
    await next.dispose()
    throw error
  }
  if (!isActive(epoch)) {
    await next.dispose()
    return
  }
  const previous = providerRuntime.fiber
  providerRuntime.fiber = next
  providerRuntime.signature = signature
  if (previous !== undefined)
    await previous.dispose()
}

function packagedSkillsDir(): string {
  const directory = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(directory, '..', 'skills'),
    resolve(directory, '..', '..', '..', 'skills'),
  ]
  const path = candidates.find(candidate => existsSync(join(candidate, 'skill-creator', 'SKILL.md')))
  if (path === undefined)
    throw new Error('Packaged skill creator is missing')
  return path
}
