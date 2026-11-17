import type { ReactElement } from 'react'
import { Icon, PlugConnection, TerminalLine } from 'dsh-tauri-ui/client'
import { useState } from 'react'

interface McpIconProps {
  name: string
  transport: string
  iconUrl?: string
}

const PLATE = 'inline-flex h-[40px] w-[40px] flex-none items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--dsw-alias-state-business-primary)_8%,transparent)] text-business'

function initialOf(name: string): string | undefined {
  const characters = Array.from(name.trim())
  const first = characters[0]
  return first === undefined ? undefined : first.toLocaleUpperCase()
}

export function McpIcon({ name, transport, iconUrl }: McpIconProps): ReactElement {
  const [failed, setFailed] = useState(false)
  if (iconUrl !== undefined && !failed)
    return <img src={iconUrl} alt="" className="h-[40px] w-[40px] flex-none rounded-xl bg-module-platform object-cover" onError={() => setFailed(true)} />

  const initial = initialOf(name)
  if (initial !== undefined)
    return <span aria-hidden="true" className={`${PLATE} text-[15px] font-medium`}>{initial}</span>

  return <span aria-hidden="true" className={PLATE}><Icon as={transport === 'stdio' ? TerminalLine : PlugConnection} size={22} /></span>
}
