import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { restart } from './restart'

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => ({ pid: 12345, unref: vi.fn() })),
}))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  openSync: vi.fn(() => 42),
}))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('桌面宿主重启归属', () => {
  it.each(['DSH_DESKTOP', 'DSH_TAURI_EMBEDDED'])('%s 托管的进程拒绝服务自行启动替身或定时退出', (marker) => {
    vi.useFakeTimers()
    vi.stubEnv('DSH_DESKTOP', undefined)
    vi.stubEnv('DSH_TAURI_EMBEDDED', undefined)
    vi.stubEnv(marker, '1')

    expect(restart.start()).toEqual({ owned: true })
    expect(spawn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
