import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Action } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { downloadSkill } from '../service/skill'
import { store } from '../store'

export function SkillDownload({ t, name }: { t: Translate, name: string }): ReactElement {
  const pending = useStore(store.skill).downloading.includes(name)

  return (
    <Action
      variant="link"
      aria-label={t('skill.downloadAria', { name })}
      title={t('skill.downloadAria', { name })}
      disabled={pending}
      onClick={() => void downloadSkill(name)}
    >
      {pending ? t('skill.downloading') : t('skill.download')}
    </Action>
  )
}
