import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { BRAND_ACCENT, BRAND_COLOR, BRAND_MARK_PATH, BRAND_NAME } from '../../../../../assets/branding'
import { PLUGIN_ID } from '../../shared/constants'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.brand.mark': { kind: 'single', scope: 'root', owner: { size: number } }
    'sidebar.brand.name': { kind: 'single', scope: 'root', owner: { children?: never } }
  }
}

const MARK_SLOTS = ['sidebar.brand.mark', 'conversation.hero.brand.mark'] as const
const NAME_SLOT = 'sidebar.brand.name'

function BrandMark({ size = 24, className }: { size?: number, className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 64 64" style={{ display: 'block', width: size, height: size, flexShrink: 0, animation: 'none' }}>
      <rect width="64" height="64" rx="15" fill={BRAND_COLOR} />
      <path d={BRAND_MARK_PATH} fill="#ffffff" fillRule="evenodd" />
      <circle cx="51" cy="11" r="3" fill={BRAND_ACCENT} />
    </svg>
  )
}

function BrandName() {
  return <span style={{ fontSize: 18, fontWeight: 650, whiteSpace: 'nowrap', letterSpacing: '-0.025em' }}>{BRAND_NAME}</span>
}

export const registerBranding = defineRegister<ClientContext>((controller, ctx, adapter) => {
  if (!adapter.has('branding.desktop'))
    return
  for (const name of MARK_SLOTS) {
    controller.add(ctx.slots.inject(name, () => ctx.slots.register({ name, registrant: PLUGIN_ID, priority: -100 }, BrandMark)))
  }
  controller.add(ctx.slots.inject(NAME_SLOT, () => ctx.slots.register({ name: NAME_SLOT, registrant: PLUGIN_ID, priority: -100 }, BrandName)))
})
