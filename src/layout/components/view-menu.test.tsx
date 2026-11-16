// @vitest-environment jsdom
import type { EventTarget } from '@tauri-apps/api/event'
import type { ComponentProps, RefObject } from 'react'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDshShortcuts } from '@/hooks/use-dsh-shortcuts'
import { Navbar } from './navbar'
import { Webview } from './webview'

const { store, userAgent, openOverlay, openUrl, toggleDevtools } = vi.hoisted(() => {
  const userAgent = navigator.userAgent
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Macintosh' })
  return {
    userAgent,
    openOverlay: vi.fn().mockResolvedValue(undefined),
    openUrl: vi.fn<(args: { url: string }) => Promise<void>>(),
    toggleDevtools: vi.fn<() => Promise<void>>(),
    store: {
      harness: { status: 'ready', serviceHealthy: true },
      recovery: { recovery: { required: false } },
      desktopUpdater: { updateInfo: null },
      setting: { zoom: vi.fn() },
    },
  }
})

vi.mock('@/store', () => ({ store }))
vi.mock('valtio-define', () => ({ useStore: (value: unknown) => value }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'macos' }))
vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: () => ({ data: [] }),
  useQueryClient: () => ({ ensureQueryData: () => Promise.resolve('dsh-tauri') }),
}))
vi.mock('@overlastic/react', () => ({ useOverlay: () => openOverlay }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/use-dsh-style', () => ({ useDshStyle: () => [{}] }))
vi.mock('@/ui/dialog/about', () => ({ DesktopAboutDialog: () => null }))
vi.mock('@/ui/dialog/config', () => ({ ConfigDialog: () => null }))
vi.mock('@/ui/dialog/update', () => ({ DesktopUpdateDialog: () => null }))
vi.mock('@/utils/clipboard', () => ({ writeClipboardText: vi.fn() }))
vi.mock('@/utils/toast', () => ({ toast: vi.fn() }))
vi.mock('@/ui/plugin/recovery', () => ({ Recovery: () => null }))
vi.mock('./setup', () => ({ Setup: () => null }))
vi.mock('./setup-preinstall', () => ({ PreinstallSetup: () => null }))
vi.mock('./iframe', () => ({
  Iframe: ({ iframeRef }: { iframeRef: RefObject<HTMLIFrameElement | null> }) => (
    <iframe ref={iframeRef} title="Harness" src="http://127.0.0.1:3081" />
  ),
}))

interface Listener {
  event: string
  target: EventTarget
  handler: number
}

interface MenuEntry {
  id: string
  enabled: boolean
  shortcut: string | null
}

const listeners = new Map<number, Listener>()
let menuEntries: MenuEntry[]

function nativeEvent(event: string, payload?: unknown, label?: string) {
  const runtime = window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }
  for (const [id, listener] of listeners) {
    if (listener.event !== event)
      continue
    if (label !== undefined && listener.target.kind !== 'Any' && (!('label' in listener.target) || listener.target.label !== label))
      continue
    runtime.__TAURI_INTERNALS__.runCallback(listener.handler, { event, id, payload })
  }
}

function iframe() {
  return screen.getByTitle<HTMLIFrameElement>('Harness')
}

function reportShortcuts() {
  const frame = iframe()
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source: frame.contentWindow,
      origin: new URL(frame.src).origin,
      data: {
        type: 'dsh://shortcuts',
        rows: [{ id: 'sidebar.left.toggle', label: 'Sidebar', keys: ['⌥', '⌘', 'B'], available: true }],
      },
    }))
  })
}

beforeEach(() => {
  listeners.clear()
  openOverlay.mockClear()
  openUrl.mockReset().mockResolvedValue(undefined)
  toggleDevtools.mockReset().mockResolvedValue(undefined)
  menuEntries = []
  store.harness.status = 'ready'
  store.harness.serviceHealthy = true
  store.setting.zoom.mockClear()
  mockWindows('main')
  mockIPC((command, args) => {
    switch (command) {
      case 'open_external_url':
        return openUrl(args as { url: string })
      case 'toggle_devtools':
        return toggleDevtools()
      case 'plugin:event|listen': {
        const listener = args as unknown as Listener
        listeners.set(listener.handler, listener)
        return listener.handler
      }
      case 'plugin:event|unlisten':
        listeners.delete((args as { eventId: number }).eventId)
        return
      case 'sync_view_menu':
        menuEntries = structuredClone((args as { entries: MenuEntry[] }).entries)
        return
      case 'plugin:window|is_fullscreen':
      case 'plugin:window|is_maximized':
        return false
      default:
        throw new Error(`Unexpected native command: ${command}`)
    }
  })
  const { result, unmount } = renderHook(useDshShortcuts)
  act(() => result.current[1]({ rows: [] }))
  unmount()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

afterAll(() => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent })
})

describe('native View menu state', () => {
  it('restores enabled commands and hints after the language change rebuilds the native menu', async () => {
    render(<Webview />)
    reportShortcuts()
    await waitFor(() => expect(menuEntries[0]).toEqual({ id: 'desktop-toggle-sidebar', enabled: true, shortcut: '⌥ ⌘ B' }))
    menuEntries = menuEntries.map(entry => ({ ...entry, enabled: false, shortcut: null }))
    act(() => nativeEvent('macos-menu-rebuilt'))
    await waitFor(() => expect(menuEntries[0]).toEqual({ id: 'desktop-toggle-sidebar', enabled: true, shortcut: '⌥ ⌘ B' }))
    expect(menuEntries.slice(1).map(entry => entry.enabled)).toEqual([false, false, false])
  })

  it('keeps the iframe and routes view commands across a local service restart', async () => {
    const view = render(<Webview />)
    reportShortcuts()
    const frame = iframe()
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    store.harness.serviceHealthy = false
    view.rerender(<Webview />)
    store.harness.serviceHealthy = true
    view.rerender(<Webview />)
    reportShortcuts()
    await waitFor(() => expect(menuEntries[0].enabled).toBe(true))
    act(() => nativeEvent('tauri://focus', null, 'main'))
    act(() => nativeEvent('macos-menu-action', 'desktop-toggle-sidebar', 'main'))
    expect(post).toHaveBeenCalledExactlyOnceWith({ source: 'dsh-desktop', type: 'dsh://view:command', command: 'sidebar.left.toggle' }, 'http://127.0.0.1:3081')
    expect(iframe()).toBe(frame)
  })

  it('clears the local catalog when the local service becomes unavailable', async () => {
    const view = render(<Webview />)
    reportShortcuts()
    store.harness.serviceHealthy = false
    view.rerender(<Webview />)
    await waitFor(() => expect(menuEntries.map(entry => entry.enabled)).toEqual([false, false, false, false]))
    store.harness.serviceHealthy = true
    view.rerender(<Webview />)
    expect(menuEntries[0]).toEqual({ id: 'desktop-toggle-sidebar', enabled: false, shortcut: null })
  })
})

describe('native View menu recipients', () => {
  function mountWindow(label: string, props: Partial<ComponentProps<typeof Navbar>> = {}) {
    mockWindows(label)
    return render(<Navbar {...props} />)
  }

  it.each(['main', 'window-2'])('delivers a targeted core command only to %s', async (label) => {
    const main = vi.fn()
    const attached = vi.fn()
    mountWindow('main', { onViewCommand: main })
    mountWindow('window-2', { onViewCommand: attached })
    await waitFor(() => expect([...listeners.values()].filter(listener => listener.event === 'macos-menu-action')).toHaveLength(2))
    act(() => nativeEvent('macos-menu-action', 'desktop-open-terminal', label))
    expect(main.mock.calls).toEqual(label === 'main' ? [['terminal.new']] : [])
    expect(attached.mock.calls).toEqual(label === 'window-2' ? [['terminal.new']] : [])
  })

  it('opens the task manager only in the targeted shell window', async () => {
    mountWindow('main')
    mountWindow('window-2')
    await waitFor(() => expect([...listeners.values()].filter(listener => listener.event === 'macos-menu-action')).toHaveLength(2))
    act(() => nativeEvent('macos-menu-action', 'desktop-task-manager', 'window-2'))
    expect(openOverlay).toHaveBeenCalledExactlyOnceWith()
  })

  it('applies a targeted zoom action once when two shell windows are open', async () => {
    mountWindow('main')
    mountWindow('window-2')
    act(() => nativeEvent('macos-menu-action', 'desktop-zoom-in', 'window-2'))
    expect(store.setting.zoom).toHaveBeenCalledExactlyOnceWith('increase')
  })

  it('unsubscribes the recipient when its shell window closes', async () => {
    const command = vi.fn()
    const view = mountWindow('window-2', { onViewCommand: command })
    await waitFor(() => expect([...listeners.values()].filter(listener => listener.event === 'macos-menu-action')).toHaveLength(1))
    view.unmount()
    await waitFor(() => expect([...listeners.values()].filter(listener => listener.event === 'macos-menu-action')).toEqual([]))
    act(() => nativeEvent('macos-menu-action', 'desktop-open-terminal', 'window-2'))
    expect(command).not.toHaveBeenCalled()
  })
})

describe('native Help menu links', () => {
  it.each([
    ['desktop-documentation', 'https://dshtauri.mintlify.site'],
  ])('opens the expected destination for %s', async (action, url) => {
    render(<Navbar />)
    await waitFor(() => expect([...listeners.values()].filter(listener => listener.event === 'macos-menu-action')).toHaveLength(1))

    act(() => nativeEvent('macos-menu-action', action, 'main'))

    await waitFor(() => expect(openUrl).toHaveBeenCalledExactlyOnceWith({ url }))
  })

  it('toggles the shell window developer tools from the native item', async () => {
    render(<Navbar />)
    await waitFor(() => expect([...listeners.values()].filter(listener => listener.event === 'macos-menu-action')).toHaveLength(1))

    act(() => nativeEvent('macos-menu-action', 'desktop-toggle-devtools', 'main'))

    await waitFor(() => expect(toggleDevtools).toHaveBeenCalledExactlyOnceWith())
  })
})
