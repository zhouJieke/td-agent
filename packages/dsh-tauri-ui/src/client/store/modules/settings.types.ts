export interface SettingsUiState {
  open: boolean
  activeId: string | undefined
  query: string
  railWidth: number | undefined
  /**
   * 打开设置前记录的会话内容宽度（`--dsh-chat-content-width` 的当值，可能是 `clamp(...)` 表达式）。
   * 设置页打开后会话区被盖住会塌缩到 640px，此值只能在打开前取。
   */
  chatContentWidth: string | undefined
  /**
   * 官方 `settings.open` 命令的生效按键：rc.2 起官方启动器座位渲染「Ctrl+,」提示。
   * 核心没有快捷键服务（老核心）或该命令未注册时为 undefined，座位拿不到就不显示提示。
   */
  launcherShortcut: { keys: readonly string[], aria?: string } | undefined
}

export type SettingsUiKey = 'back' | 'search' | 'settings' | 'noResults'
