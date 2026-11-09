import type { ClientContext } from 'dsh-tauri/client'
import { defineRegister } from 'dsh-tauri/client'
import { SkillCreatorPrefill } from '../components/skill-creator-prefill'
import { PLUGIN_ID } from '../constants'
import { store } from '../store'

const INPUT_SLOT = 'conversation.input.left'

export const skillCreatorPrefillFeature = defineRegister<ClientContext>((controller, ctx) => {
  controller.add(ctx.slots.inject(INPUT_SLOT, () => ctx.slots.register({
    name: INPUT_SLOT,
    id: `${PLUGIN_ID}.skill-prefill`,
    registrant: PLUGIN_ID,
    order: 40,
    priority: 0,
  }, SkillCreatorPrefill)))
  controller.add(() => store.prefill.clear())
})
