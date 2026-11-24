import type { DshShortcutRow, DshViewCommand } from '@/hooks/use-dsh-shortcuts'
import { useWatch } from '@reause/core'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type } from '@tauri-apps/plugin-os'
import { useEffect, useRef, useState } from 'react'
import { If } from 'react-if-lite'
import { useStore } from 'valtio-define'
import { useAppearance } from '@/hooks/use-appearance'
import { DSH_VIEW_COMMANDS, shortcutHint, useDshShortcuts } from '@/hooks/use-dsh-shortcuts'
import { useDshStyle } from '@/hooks/use-dsh-style'
import { useIframeMessage } from '@/hooks/use-iframe-message'
import { useIframePost } from '@/hooks/use-iframe-post'
import { useListen } from '@/hooks/use-listen'
import { store } from '@/store'
import { Recovery } from '@/ui/plugin/recovery'
import { FullSidebarNavbar } from './full-sidebar-navbar'
import { Iframe } from './iframe'
import { Navbar } from './navbar'
import { Setup } from './setup'
import { isFullSidebarWindow } from './window-presentation'

interface NavBridgeMessage {
  type?: string
  collapsed?: boolean
  rows?: unknown
}

const FULL_SIDEBAR_REVEAL_MS = 15_000

export function Webview() {
  const [fullSidebarRevealed, setFullSidebarRevealed] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const appearanceCss = useAppearance(iframeRef)
  const post = useIframePost(iframeRef)

  const [dshStyle] = useDshStyle()
  const [{ rows: shortcutRows }, setDshShortcuts] = useDshShortcuts()

  const { status, serviceHealthy, serviceRunning, iframeKey, iframeLoaded, iframeAlive, iframeError, startupPhase, busyAction } = useStore(store.harness)
  const { recovery } = useStore(store.recovery)
  const live = status === 'ready' && serviceHealthy
  const branch = status === 'ready' ? 'iframe' : status === 'error' && recovery.required ? 'recovery' : 'setup'
  useWatch([branch, status, serviceHealthy, serviceRunning, iframeKey, iframeLoaded, iframeAlive, iframeError, startupPhase, busyAction], () => {
    console.warn('[Webview] shell view', {
      branch,
      status,
      serviceHealthy,
      serviceRunning,
      iframeKey,
      iframeLoaded,
      iframeAlive,
      iframeError,
      startupPhase,
      busyAction,
    })
  }, { immediate: true })

  function syncViewMenu() {
    if (type() !== 'macos')
      return
    void invoke('sync_view_menu', {
      entries: DSH_VIEW_COMMANDS.map(item => ({
        id: item.action,
        enabled: live && shortcutRows.some(row => row.id === item.command && row.available === true),
        shortcut: shortcutHint(shortcutRows, item.command) ?? null,
      })),
    }).catch(error => console.error('[Webview] failed to sync View menu:', error))
  }

  useWatch([shortcutRows, live], syncViewMenu, { immediate: true })
  useWatch(live, (ready) => {
    if (!ready)
      setDshShortcuts({ rows: [] })
  })
  useListen('tauri://focus', syncViewMenu, { target: getCurrentWindow().label })
  useListen('macos-menu-rebuilt', syncViewMenu, { target: getCurrentWindow().label })

  useIframeMessage<NavBridgeMessage>(iframeRef, (data) => {
    if (data.type === 'dsh://sidebar:collapsed') {
      setSidebarCollapsed(Boolean(data.collapsed))
    }
    else if (data.type === 'dsh://shortcuts') {
      setDshShortcuts({ rows: parseShortcutRows(data.rows) })
    }
    else if (data.type === 'dsh://full-sidebar:ready') {
      setFullSidebarRevealed(true)
    }
    else if (data.type === 'dsh://window:close') {
      void getCurrentWindow().close()
    }
  })

  const renderContent = () => {
    switch (status) {
      case 'error':
        return (
          <If cond={recovery.required} else={<Setup />}>
            <Recovery fullScreen />
          </If>
        )
      case 'ready':
        return <Iframe iframeRef={iframeRef} />
      default:
        return <Setup />
    }
  }

  // 窗口形态在进程内不会变：建窗时注入一次载荷，这里读一次就够。
  const fullSidebar = isFullSidebarWindow()

  // 全屏形态窗口先盖住内容区：插件在帧内就位前不露半成品 chrome，兜底超时后强制揭开。
  useEffect(() => {
    if (!fullSidebar || fullSidebarRevealed)
      return
    const timer = window.setTimeout(setFullSidebarRevealed, FULL_SIDEBAR_REVEAL_MS, true)
    return () => window.clearTimeout(timer)
  }, [fullSidebar, fullSidebarRevealed])

  const bridge = live
    ? {
        onToggleSidebar: () => post({ type: 'dsh://sidebar:toggle' }),
        onNewChat: () => post({ type: 'dsh://session:new' }),
        onOpenFolder: () => post({ type: 'dsh://workspace:add' }),
        onOpenShortcuts: () => post({ type: 'dsh://shortcuts:open' }),
        onViewCommand: (command: DshViewCommand) => post({ type: 'dsh://view:command', command }),
      }
    : {}

  return (
    <main className="relative flex flex-col min-h-0 flex-1" style={dshStyle.frame || {}}>
      {/* 挂在 Iframe 外：启动页/预装引导/恢复页先于 Iframe 渲染，否则拿不到透明与调色板 token */}
      <style>{appearanceCss}</style>
      <If
        cond={fullSidebar}
        then={<FullSidebarNavbar />}
        else={<Navbar sidebarCollapsed={sidebarCollapsed} {...bridge} />}
      />
      <div className="relative flex min-h-0 flex-1">
        {renderContent()}
        <If cond={fullSidebar && !fullSidebarRevealed && status === 'ready'}>
          <div className="absolute inset-0 z-10" data-testid="dsh-full-sidebar-cover" style={{ background: dshStyle.sidebar?.background }} />
        </If>
      </div>
    </main>
  )
}

function parseShortcutRows(rows: unknown): DshShortcutRow[] {
  if (!Array.isArray(rows))
    return []
  const out: DshShortcutRow[] = []
  for (const row of rows) {
    if (typeof row !== 'object' || row === null)
      continue
    const entry = row as { id?: unknown, label?: unknown, keys?: unknown, aria?: unknown, available?: unknown }
    if (typeof entry.id !== 'string' || typeof entry.label !== 'string')
      continue
    out.push({
      id: entry.id,
      label: entry.label,
      keys: Array.isArray(entry.keys) ? entry.keys.filter((key): key is string => typeof key === 'string') : [],
      ...typeof entry.aria === 'string' ? { aria: entry.aria } : {},
      available: entry.available === true,
    })
  }
  return out
}
