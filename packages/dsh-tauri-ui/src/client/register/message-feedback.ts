import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../../shared/constants'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.chat.assistant-actions': { kind: 'list', scope: 'session', owner: { messageId: MessageId } }
  }
}

const HIDDEN_ACTIONS = [
  ['conversation.chat.assistant-actions', 'feedback'],
  ['conversation.session.header.utilities', 'session-log-download'],
] as const

function HiddenAction() {
  return null
}

export const registerMessageFeedback = defineRegister<ClientContext>((controller, ctx, adapter) => {
  if (!adapter.has('branding.desktop'))
    return
  for (const [name, id] of HIDDEN_ACTIONS) {
    controller.add(ctx.slots.inject(name, () => {
      const spec = ctx.slots.spec(name)
      if (spec?.kind !== 'list' || spec.scope !== 'session')
        return () => {}
      return ctx.slots.register({ name, id, registrant: PLUGIN_ID, priority: -100 }, HiddenAction)
    }))
  }
})
