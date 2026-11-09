import type { ClientContext } from 'dsh-tauri/client'
import { GraduationCap, Icon } from 'dsh-tauri-ui/client'
import { definePanel, defineRegister } from 'dsh-tauri/client'
import { SkillHubPanel } from '../components/skill-hub-panel'
import { PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'
import { loadSkillHub } from '../service/skill'
import { store } from '../store'
import { chooseWorkspace, sessionSnapshotOf, workspaceSnapshotOf } from './panel.utils'

export const panelFeature = defineRegister<ClientContext>((controller, ctx, adapter) => {
  void loadSkillHub()
  const panel = definePanel(ctx, {
    id: PANEL_ID,
    order: PANEL_ACTION_ORDER,
    locale: locale.NS,
    label: () => locale.text('skillHub'),
    icon: props => <Icon as={GraduationCap} size={props.size} />,
    render: () => <SkillHubPanel t={locale.text} createSkill={createSkill} />,
  })
  controller.add(panel.dispose)

  async function createSkill(): Promise<void> {
    const createSession = adapter.sessions.create
    if (!adapter.has('workspaces.list') || !adapter.has('sessions.create') || !adapter.has('navigation.openSession')
      || typeof createSession !== 'function') {
      throw new Error(locale.text('creatorUnavailable'))
    }
    const workspaceId = chooseWorkspace(
      sessionSnapshotOf(adapter.sessions.list?.getSnapshot()),
      workspaceSnapshotOf(adapter.workspaces.list?.getSnapshot()),
    )
    if (workspaceId === undefined)
      throw new Error(locale.text('workspaceUnavailable'))
    const sessionId = await createSession({ workspaceId })
    if (controller.isDisposed())
      throw new Error(locale.text('creatorUnavailable'))
    if (typeof sessionId !== 'string' || sessionId === '')
      throw new Error(locale.text('workspaceUnavailable'))
    store.prefill.add(sessionId)
    try {
      const outcome = adapter.openSession(sessionId)
      if (outcome.status !== 'opened')
        throw new Error(outcome.reason)
      await outcome.value
      if (controller.isDisposed())
        throw new Error(locale.text('creatorUnavailable'))
      panel.close()
    }
    catch (error) {
      store.prefill.consume(sessionId)
      throw error
    }
  }
})
