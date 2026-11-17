// @vitest-environment jsdom
import { createContext, runInContext } from 'node:vm'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useInvokeIframe } from '../../../../src/hooks/use-invoke-iframe'
import { postHostRestart } from '../../../dsh-tauri-extension/src/client/apis'
import { restartHost } from '../../../dsh-tauri-extension/src/client/service/restart'
import { apply } from './apply'

const shell = vi.hoisted(() => ({
  restart: vi.fn(async () => {}),
  invoke: vi.fn(),
  receive: undefined,
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: shell.invoke }))
vi.mock('@/store/modules/harness', () => ({ harness: { restart: shell.restart } }))
vi.mock('@/hooks/use-iframe-message', () => ({
  useIframeMessage: (_ref, receive) => { shell.receive = receive },
}))
vi.mock('../../../dsh-tauri-extension/src/client/apis', () => ({ postHostRestart: vi.fn(async () => ({ ok: true })) }))

afterEach(() => {
  cleanup()
  shell.receive = undefined
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function desktopScript() {
  const rows = []
  apply({
    connection: { authorizeIndex: () => false },
    webServer: { register: () => () => {} },
    effect: (callback) => { callback() },
    on: (_event, listener) => {
      listener(rows)
      return () => {}
    },
  })
  const row = rows.find(item => item.kind === 'script' && item.text.includes('protocolVersion'))
  if (row?.kind !== 'script')
    throw new Error('Desktop bridge script is missing')
  return row.text
}

describe('桌面 MCP 重启链路', () => {
  it('重启经实际桌面注入脚本交给壳层流程，不调用服务自行重启接口', async () => {
    vi.stubEnv('DSH_TAURI_EMBEDDED', '1')
    const reply = vi.fn()
    const frame = { current: { contentWindow: { postMessage: reply } } }
    renderHook(() => useInvokeIframe(frame))
    const sandbox = {
      location: { search: '?dshDesktop=1' },
      navigator: { userAgent: 'tauri-test' },
      URLSearchParams,
      parent: { postMessage: data => shell.receive(data, { origin: 'http://127.0.0.1:3081' }) },
    }
    runInContext(desktopScript(), createContext(sandbox))
    vi.stubGlobal('window', sandbox)

    await expect(restartHost()).resolves.toEqual({ ok: true })
    vi.unstubAllGlobals()

    expect(postHostRestart).not.toHaveBeenCalled()
    expect(shell.restart).toHaveBeenCalledExactlyOnceWith()
    expect(shell.invoke).not.toHaveBeenCalled()
    await waitFor(() => expect(reply).toHaveBeenCalledWith(
      { type: 'dsh://tauri:reply', nonce: '', ok: true, value: undefined },
      'http://127.0.0.1:3081',
    ))
  })
})
