import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Action } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { downloadSkill } from '../service/skill'
import { store } from '../store'

export function SkillDownload({ t, name }: { t: Translate, name: string }): ReactElement {
  const state = useStore(store.skill)
  const installed = state.installedNames.includes(name)
  const pending = state.downloading.includes(name)
  const unavailable = state.installedError !== ''
  const checking = state.installedLoading || !state.installedChecked
  const text = installed
    ? t('skill.downloaded')
    : pending
      ? t('skill.downloading')
      : unavailable
        ? t('skill.statusUnavailable')
        : checking
          ? t('skill.checking')
          : t('skill.download')
  const label = installed
    ? t('skill.downloadedAria', { name })
    : pending
      ? t('skill.downloadingAria', { name })
      : unavailable
        ? t('skill.statusUnavailableAria', { name })
        : checking
          ? t('skill.checkingAria', { name })
          : t('skill.downloadAria', { name })

  return (
    <Action
      variant="link"
      aria-label={label}
      title={label}
      disabled={installed || pending || unavailable || checking}
      onClick={() => void downloadSkill(name)}
    >
      {text}
    </Action>
  )
}
