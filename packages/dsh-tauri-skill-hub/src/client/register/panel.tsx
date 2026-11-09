import type { ClientContext } from 'dsh-tauri/client'
import { GraduationCap, Icon } from 'dsh-tauri-ui/client'
import { defineAdapter, definePanel, defineRegister } from 'dsh-tauri/client'
import { SkillHubPanel } from '../components/skill-hub-panel'
import { PANEL_ACTION_ORDER, PANEL_ID } from '../constants'
import { locale } from '../locales'
import { loadSkillHub } from '../service/skill'
import { store } from '../store'
import { chooseWorkspace, sessionSnapshotOf, workspaceSnapshotOf } from './panel.utils'

export const panelFeature = defineRegister<ClientContext>((controller, ctx) => {
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
    const adapter = defineAdapter(ctx)
    const createSession = adapter.sessions.create
    const missing = [
      !adapter.has('workspaces.list') && 'workspaces.list',
      (!adapter.has('sessions.create') || typeof createSession !== 'function') && 'sessions.create',
      !adapter.has('navigation.openSession') && 'navigation.openSession',
    ].filter((capability): capability is string => typeof capability === 'string')
    if (typeof createSession !== 'function' || missing.length > 0) {
      console.error(`[skill-hub] Skill creator unavailable: ${missing.join(', ')}`)
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
      throw new Error(locale.text('creatorInterrupted'))
    if (typeof sessionId !== 'string' || sessionId === '')
      throw new Error(locale.text('workspaceUnavailable'))
    store.prefill.add(sessionId)
    try {
      const outcome = adapter.openSession(sessionId)
      if (outcome.status !== 'opened')
        throw new Error(outcome.reason)
      await outcome.value
      if (controller.isDisposed())
        throw new Error(locale.text('creatorInterrupted'))
      panel.close()
    }
    catch (error) {
      store.prefill.consume(sessionId)
      throw error
    }
  }
})
