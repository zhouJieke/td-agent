import type { ClientContext } from 'dsh-tauri/client'
import { Icon, Panel, PlugConnection } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister } from 'dsh-tauri/client'
import { McpTab } from '../components/mcp-tab'
import { PLUGIN_ID } from '../constants'
import { locale } from '../locales'

export const mcpPanelFeature = defineRegister<ClientContext>((controller, ctx) => {
  const panel = definePanel(ctx, {
    id: `${PLUGIN_ID}.mcp`,
    order: 61,
    locale: locale.NS,
    label: () => locale.text('mcpManagement'),
    icon: props => <Icon as={PlugConnection} size={props.size} />,
    render: function McpPage() {
      locale.useLocale()
      return <Panel><McpTab t={locale.text} /></Panel>
    },
  })
  controller.add(panel.dispose)
})
