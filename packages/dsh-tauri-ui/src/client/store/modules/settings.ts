import type { SettingsUiState } from './settings.types'
import { defineStore } from 'dsh-tauri/client'

function readChatContentWidth(): string | undefined {
  const dock = document.querySelector('[data-slot="conversation.input.dock"]')
  const width = dock === null
    ? ''
    : getComputedStyle(dock).getPropertyValue('--dsh-chat-content-width').trim()
  return width === '' ? undefined : width
}

export const settings = defineStore({
  state: (): SettingsUiState => ({
    open: false,
    activeId: undefined,
    query: '',
    railWidth: undefined,
    chatContentWidth: undefined,
    launcherShortcut: undefined,
  }),
  actions: {
    openAt(sectionId?: string) {
      if (!this.open)
        this.chatContentWidth = readChatContentWidth()
      this.open = true
      if (sectionId !== undefined)
        this.activeId = sectionId
    },
    close() {
      this.open = false
      this.activeId = undefined
      this.query = ''
      this.railWidth = undefined
    },
    select(id: string) {
      this.activeId = id
    },
    setQuery(query: string) {
      this.query = query
    },
    setRailWidth(px: number) {
      this.railWidth = px
    },
    setLauncherShortcut(shortcut: SettingsUiState['launcherShortcut']) {
      this.launcherShortcut = shortcut
    },
  },
})
