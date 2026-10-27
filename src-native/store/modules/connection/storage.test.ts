import type { ConnectionSnapshot } from './index'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { connection, createConnectionState, parseConnectionSnapshot, resetConnectionStorageCache } from './index'
import { restoreConnections } from './storage'

const native = vi.hoisted(() => ({
  read: vi.fn<(key: string) => Promise<string | null>>(),
  write: vi.fn<(key: string, value: string) => Promise<void>>(),
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: native.read, setItem: native.write } }))
vi.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'zh-CN' }] }))

const alpha = { id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/tasks?theme=dark', host: 'bridge.local', port: 3080 }
const beta = { id: 'https://second.local', url: 'https://second.local/workspaces', host: 'second.local', port: 443 }
const emptySnapshot: ConnectionSnapshot = { version: 1, history: [], guidedHosts: [] }
const emptyPayload = payload([])
const storageFailure = i18n.t('connection.storageFailed')

function payload(history: ConnectionSnapshot['history'], guidedHosts: string[] = []): string {
  return JSON.stringify({ version: 1, history, guidedHosts })
}

function writtenPayloads(): string[] {
  return native.write.mock.calls.map(call => call[1])
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function hydrate(snapshot: ConnectionSnapshot = emptySnapshot): Promise<void> {
  native.read.mockResolvedValue(JSON.stringify(parseConnectionSnapshot(snapshot)))
  await restoreConnections()
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  connection.$persist.meta.hydrated = false
  connection.$persist.meta.mounted = false
  connection.$patch(createConnectionState())
  resetConnectionStorageCache()
  vi.resetAllMocks()
  native.read.mockResolvedValue(null)
  native.write.mockResolvedValue(undefined)
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('connection editing persistence', () => {
  it('persists a renamed host and the clean snapshot when the active connection is forgotten', async () => {
    await hydrate({ version: 1, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [alpha.id] })
    connection.accept(alpha)
    connection.rename(alpha.id, '我的电脑')
    await vi.advanceTimersByTimeAsync(0)
    expect(JSON.parse(writtenPayloads().at(-1)!)).toEqual({ version: 1, history: [{ ...alpha, name: '我的电脑', lastConnectedAt: 10 }], guidedHosts: [alpha.id] })
    connection.forget(alpha.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(writtenPayloads().at(-1)).toBe(emptyPayload)
  })
})

describe('restoreConnections', () => {
  it('restores sanitized history from the persisted snapshot without accepting its plaintext map', async () => {
    native.read.mockResolvedValue(JSON.stringify({
      version: 1,
      history: [
        { id: 'https://evil.test', url: 'http://BRIDGE.local:3080/tasks?auth=plaintext&token=other&theme=dark#private', host: 'evil.test', port: 9, token: 'injected', lastConnectedAt: 10 },
        { url: 'https://second.local/workspaces', lastConnectedAt: 20 },
        { url: 'ftp://wrong.local', lastConnectedAt: 30 },
      ],
      tokens: { 'http://bridge.local:3080': 'plaintext-map' },
      guidedHosts: ['http://bridge.local:3080', 'https://evil.test'],
    }))
    await restoreConnections()
    expect(native.read).toHaveBeenCalledExactlyOnceWith('dsh-bridge/connections')
    expect(connection.hydrated).toBe(true)
    expect(connection.history).toEqual([{ ...beta, lastConnectedAt: 20 }, { ...alpha, lastConnectedAt: 10 }])
    expect(connection.guidedHosts).toEqual(['http://bridge.local:3080'])
    expect(connection.current).toBeNull()
    expect(connection.stage).toBe('idle')
    expect(native.write).not.toHaveBeenCalled()
    await restoreConnections()
    expect(native.read).toHaveBeenCalledTimes(1)
  })

  it('hydrates an empty store and persists the clean snapshot when there is no persisted snapshot', async () => {
    await restoreConnections()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.hydrated).toBe(true)
    expect(connection.serialize()).toEqual({ version: 1, history: [], guidedHosts: [] })
    expect(connection.notice).toBeNull()
    expect(native.write).toHaveBeenCalledExactlyOnceWith('dsh-bridge/connections', emptyPayload)
  })

  it('rejects untrusted persisted address schemes and credentials', async () => {
    native.read.mockResolvedValue(JSON.stringify({
      version: 1,
      history: [
        { url: 'javascript:alert(1)', lastConnectedAt: 1 },
        { url: 'http://user:secret@bridge.local:3080/', lastConnectedAt: 2 },
        { url: 'http://bridge.local:65536/', lastConnectedAt: 3 },
        { url: 'http://bad.local', lastConnectedAt: -1 },
      ],
      guidedHosts: ['http://bridge.local:3080'],
      tokens: { 'http://bridge.local:3080': 'untrusted' },
    }))
    await restoreConnections()
    expect(connection.serialize()).toEqual({ version: 1, history: [], guidedHosts: [] })
    expect(connection.hydrated).toBe(true)
    expect(native.write).not.toHaveBeenCalled()
  })

  it('reports malformed persisted JSON without accepting its embedded secret and replaces it with a clean snapshot', async () => {
    native.read.mockResolvedValue('{"version":1,"tokens":{"bad":"secret"}')
    await restoreConnections()
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.hydrated).toBe(true)
    expect(connection.serialize()).toEqual({ version: 1, history: [], guidedHosts: [] })
    expect(connection.notice).toBe(storageFailure)
    expect(native.write).toHaveBeenCalledExactlyOnceWith('dsh-bridge/connections', emptyPayload)
  })

  it('discards unsupported snapshot versions', async () => {
    native.read.mockResolvedValue(JSON.stringify({ version: 2, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [] }))
    await restoreConnections()
    expect(connection.hydrated).toBe(true)
    expect(connection.history).toEqual([])
    expect(native.write).not.toHaveBeenCalled()
  })

  it('reports a native history-read error and completes safe empty hydration', async () => {
    const error = new Error('History storage unavailable')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    native.read.mockRejectedValue(error)
    await restoreConnections()
    expect(connection.hydrated).toBe(true)
    expect(connection.serialize()).toEqual({ version: 1, history: [], guidedHosts: [] })
    expect(connection.notice).toBe(storageFailure)
    expect(log).toHaveBeenCalledExactlyOnceWith('[connection] restore failed:', error)
    expect(native.write).not.toHaveBeenCalled()
  })

  it('stops writing history after a failed read and resumes once a read succeeds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    native.read.mockRejectedValueOnce(new Error('History storage unavailable'))
    await restoreConnections()
    expect(connection.hydrated).toBe(true)
    expect(native.write).not.toHaveBeenCalled()

    connection.$patch(createConnectionState())
    connection.$persist.meta.hydrated = false
    connection.$persist.meta.mounted = false
    native.read.mockResolvedValue(JSON.stringify(parseConnectionSnapshot({ version: 1, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [] })))
    await restoreConnections()
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.history).toEqual([{ ...alpha, lastConnectedAt: 10 }])
    expect(writtenPayloads()).not.toContain(emptyPayload)
  })

  it('never writes before history hydration finishes and does not echo the snapshot already on disk', async () => {
    const historyRead = deferred<string | null>()
    native.read.mockReturnValue(historyRead.promise)
    const restoring = restoreConnections()
    connection.setNotice('Restoring')
    await vi.advanceTimersByTimeAsync(0)
    expect(connection.hydrated).toBe(false)
    expect(native.write).not.toHaveBeenCalled()
    historyRead.resolve(payload([{ ...alpha, lastConnectedAt: 10 }]))
    await restoring
    await vi.advanceTimersByTimeAsync(0)

    expect(connection.hydrated).toBe(true)
    expect(connection.history).toEqual([{ ...alpha, lastConnectedAt: 10 }])
    expect(native.write).not.toHaveBeenCalled()
  })
})

describe('connection snapshot ordering', () => {
  it('persists restored history after an earlier different snapshot finishes saving', async () => {
    const saved = payload([{ ...alpha, lastConnectedAt: 10 }])
    let disk = saved
    await hydrate({ version: 1, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [] })
    const pending = deferred<void>()
    native.write.mockImplementationOnce(async (_key, value) => {
      await pending.promise
      disk = value
    }).mockImplementation(async (_key, value) => { disk = value })
    connection.$patch({ history: [{ ...beta, lastConnectedAt: 20 }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledTimes(1)
    connection.$patch({ history: [{ ...alpha, lastConnectedAt: 10 }] })
    await vi.advanceTimersByTimeAsync(0)
    pending.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(disk).toBe(saved)
    expect(writtenPayloads()).toEqual([payload([{ ...beta, lastConnectedAt: 20 }]), saved])
  })

  it('does not repeat pending snapshot writes for transient UI changes', async () => {
    await hydrate()
    const pending = deferred<void>()
    native.write.mockReturnValueOnce(pending.promise)
    connection.$patch({ history: [{ ...alpha, lastConnectedAt: 10 }] })
    await vi.advanceTimersByTimeAsync(0)
    connection.setDrawerOpen(true)
    await vi.advanceTimersByTimeAsync(0)
    connection.setNotice('Still saving')
    await vi.advanceTimersByTimeAsync(0)
    pending.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledExactlyOnceWith('dsh-bridge/connections', payload([{ ...alpha, lastConnectedAt: 10 }]))
  })

  it('does not write any pre-hydration runtime changes', async () => {
    connection.accept({ ...alpha, token: 'not-yet-hydrated' })
    connection.markLoaded(connection.viewGeneration, 10)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).not.toHaveBeenCalled()
  })

  it('excludes route secrets from a successful history serialization', async () => {
    await hydrate()
    connection.accept({ ...alpha, url: 'http://bridge.local:3080/tasks?auth=qr-secret&token=other&theme=dark#private', token: 'secure-secret' })
    connection.markLoaded(connection.viewGeneration, 10)
    connection.dismissHint()
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledExactlyOnceWith('dsh-bridge/connections', payload([{ ...alpha, lastConnectedAt: 10 }], ['http://bridge.local:3080']))
    expect(native.write.mock.calls[0]?.[1]).not.toContain('secret')
    expect(native.write.mock.calls[0]?.[1]).not.toContain('auth')
  })

  it('queues later normalized snapshots until an earlier snapshot write completes', async () => {
    const firstWrite = deferred<void>()
    native.write.mockReturnValueOnce(firstWrite.promise)
    await hydrate()
    connection.accept(alpha)
    connection.markLoaded(connection.viewGeneration, 10)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledTimes(1)
    connection.accept(beta)
    connection.markLoaded(connection.viewGeneration, 20)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledTimes(1)
    expect(JSON.parse(native.write.mock.calls[0]![1])).toEqual({ version: 1, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [] })
    firstWrite.resolve(undefined)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write.mock.calls.map(call => [call[0], JSON.parse(call[1])])).toEqual([
      ['dsh-bridge/connections', { version: 1, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [] }],
      ['dsh-bridge/connections', { version: 1, history: [{ ...beta, lastConnectedAt: 20 }, { ...alpha, lastConnectedAt: 10 }], guidedHosts: [] }],
    ])
  })

  it('writes the pruned history when an origin is evicted', async () => {
    await hydrate({ version: 1, history: [{ ...alpha, lastConnectedAt: 10 }, { ...beta, lastConnectedAt: 5 }], guidedHosts: [] })
    connection.$patch({ history: [{ ...beta, lastConnectedAt: 5 }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledExactlyOnceWith('dsh-bridge/connections', payload([{ ...beta, lastConnectedAt: 5 }]))
  })

  it('does not rewrite an unchanged snapshot for transient UI changes', async () => {
    await hydrate()
    connection.setNotice('First notice')
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).not.toHaveBeenCalled()
    connection.setNotice('Second notice')
    connection.setDrawerOpen(true)
    connection.setHealth('http://bridge.local:3080', 'unavailable')
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).not.toHaveBeenCalled()
  })
})

describe('connection persistence failures', () => {
  it('saves the queued latest snapshot after an earlier write rejects', async () => {
    await hydrate()
    const pending = deferred<void>()
    const error = new Error('First write failed')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    let disk = emptyPayload
    native.write.mockImplementationOnce(async () => pending.promise)
      .mockImplementation(async (_key, value) => { disk = value })
    connection.$patch({ history: [{ ...alpha, lastConnectedAt: 10 }] })
    await vi.advanceTimersByTimeAsync(0)
    connection.$patch({ history: [{ ...beta, lastConnectedAt: 20 }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write).toHaveBeenCalledTimes(1)
    pending.reject(error)
    await vi.advanceTimersByTimeAsync(0)
    expect(disk).toBe(payload([{ ...beta, lastConnectedAt: 20 }]))
    expect(native.write).toHaveBeenCalledTimes(2)
    expect(connection.notice).toBe(storageFailure)
    expect(log).toHaveBeenCalledExactlyOnceWith('[connection] save failed:', error)
  })

  it('reports a public snapshot write failure and permits a subsequent successful save', async () => {
    const error = new Error('Disk full')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    native.write.mockRejectedValueOnce(error)
    await restoreConnections()
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalledExactlyOnceWith('[connection] save failed:', error)
    expect(connection.notice).toBe(storageFailure)
    connection.accept({ ...alpha, token: 'secure-secret' })
    connection.markLoaded(connection.viewGeneration, 10)
    await vi.advanceTimersByTimeAsync(0)
    expect(native.write.mock.calls.map(call => [call[0], JSON.parse(call[1])])).toEqual([
      ['dsh-bridge/connections', { version: 1, history: [], guidedHosts: [] }],
      ['dsh-bridge/connections', { version: 1, history: [], guidedHosts: [] }],
      ['dsh-bridge/connections', { version: 1, history: [{ ...alpha, lastConnectedAt: 10 }], guidedHosts: [] }],
    ])
    expect(writtenPayloads()[2]).not.toContain('secure-secret')
  })
})
