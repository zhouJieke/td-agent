import { desktopUpdater } from './modules/desktop-updater'
import { harness } from './modules/harness'
import { harnessUpdater } from './modules/harness-updater'
import { plugins } from './modules/plugins'
import { recovery } from './modules/recovery'
import { setting } from './modules/setting'

export const store = {
  harness,
  harnessUpdater,
  plugins,
  recovery,
  setting,
  desktopUpdater,
}
