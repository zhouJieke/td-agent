import type { ClientContext } from 'dsh-tauri/client'
import { Database, Icon } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister } from 'dsh-tauri/client'
import { TokenStatsPanel } from '../components/token-stats-panel'
import { PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'

export const panelFeature = defineRegister<ClientContext>((controller, ctx) => {
  const panel = definePanel(ctx, {
    id: PANEL_ID,
    order: PANEL_ACTION_ORDER,
    locale: locale.NS,
    label: () => locale.text('tokenStats'),
    icon: props => <Icon as={Database} size={props.size} />,
    render: () => <TokenStatsPanel t={locale.text} />,
  })
  controller.add(panel.dispose)
})
