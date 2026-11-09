import { useStore, useWatchImmediate } from 'dsh-tauri/client'
import { store } from '../store'

const SKILL_CREATOR_DRAFT = '/skill-creator '

export function SkillCreatorPrefill({ sessionId, inputActions }: {
  sessionId: string
  inputActions: { setDraft: (text: string) => void }
}): null {
  const { pendingSessionIds } = useStore(store.prefill)
  const pending = pendingSessionIds.includes(sessionId)
  useWatchImmediate([pending, sessionId, inputActions], () => {
    if (!pending)
      return
    inputActions.setDraft(SKILL_CREATOR_DRAFT)
    store.prefill.consume(sessionId)
  })
  return null
}
