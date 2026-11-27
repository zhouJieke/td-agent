import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import brandMark from '../../../../../assets/brand-mark.png'
import { BRAND_NAME } from '../../../../../assets/branding'
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
    <img src={brandMark} className={className} alt="" aria-hidden="true" style={{ display: 'block', width: size, height: size, flexShrink: 0, animation: 'none' }} />
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
