import { defineStore, uniq } from 'dsh-tauri/client'

export const prefill = defineStore({
  state: (): { pendingSessionIds: string[] } => ({ pendingSessionIds: [] }),
  actions: {
    add(sessionId: string) {
      this.pendingSessionIds = uniq([...this.pendingSessionIds, sessionId])
    },
    consume(sessionId: string): boolean {
      if (!this.pendingSessionIds.includes(sessionId))
        return false
      this.pendingSessionIds = this.pendingSessionIds.filter(id => id !== sessionId)
      return true
    },
    clear() {
      this.pendingSessionIds = []
    },
  },
})
