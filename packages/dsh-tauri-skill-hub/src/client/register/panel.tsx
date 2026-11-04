import type { ClientContext } from 'dsh-tauri/client'
import { GraduationCap, Icon } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister } from 'dsh-tauri/client'
import { SkillHubPanel } from '../components/skill-hub-panel'
import { PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'
import { loadSkillHub } from '../service/skill'

export const panelFeature = defineRegister<ClientContext>((controller, ctx) => {
  void loadSkillHub()
  const panel = definePanel(ctx, {
    id: PANEL_ID,
    order: PANEL_ACTION_ORDER,
    locale: locale.NS,
    label: () => locale.text('skillHub'),
    icon: props => <Icon as={GraduationCap} size={props.size} />,
    render: () => <SkillHubPanel t={locale.text} />,
  })
  controller.add(panel.dispose)
})
