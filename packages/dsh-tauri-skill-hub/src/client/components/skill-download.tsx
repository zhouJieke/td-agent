import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Action, Button, Modal, Text } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { useState } from 'react'
import { downloadSkill, updateSkill } from '../service/skill'
import { store } from '../store'
import { installedSkillVersion, isNewerSkillVersion, isSkillVersion } from '../store/modules/skill.utils'

export function SkillDownload({ t, name, latestVersion }: { t: Translate, name: string, latestVersion?: string }): ReactElement {
  const state = useStore(store.skill)
  const [confirmUnknown, setConfirmUnknown] = useState(false)
  const installed = state.installedNames.includes(name)
  const pending = state.downloading.includes(name)
  const unavailable = state.installedError !== ''
  const checking = state.installedLoading || !state.installedChecked
  const localVersion = installedSkillVersion(state.installedVersions, name)
  const knownLocal = isSkillVersion(localVersion)
  const targetVersion = isSkillVersion(latestVersion) ? latestVersion : null
  const canUpdate = installed && state.updatableNames.includes(name) && targetVersion !== null
    && (!knownLocal || isNewerSkillVersion(targetVersion, localVersion))
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
    <>
      <Action
        variant="link"
        aria-label={label}
        title={label}
        disabled={installed || pending || unavailable || checking}
        onClick={() => void downloadSkill(name)}
      >
        {text}
      </Action>
      {installed && !knownLocal && <Text tone="tertiary" size="xs">{t('skill.localVersionUnknown')}</Text>}
      {installed && targetVersion === null && <Text tone="tertiary" size="xs">{t('skill.remoteVersionUnknown')}</Text>}
      {installed && !state.updatableNames.includes(name) && <Text tone="tertiary" size="xs">{t('skill.updateUnsafe')}</Text>}
      {canUpdate && targetVersion !== null && (
        <Action
          variant="link"
          aria-label={pending ? t('skill.updatingAria', { name }) : t('skill.updateAria', { name })}
          disabled={pending || unavailable || checking}
          onClick={() => {
            if (!knownLocal)
              setConfirmUnknown(true)
            else
              void updateSkill({ name, latestVersion: targetVersion, installedVersion: localVersion })
          }}
        >
          {pending ? t('skill.updating') : t('skill.update')}
        </Action>
      )}
      <Modal
        open={confirmUnknown}
        onClose={() => setConfirmUnknown(false)}
        closeLabel={t('close')}
        title={t('skill.updateConfirmTitle')}
        description={name}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirmUnknown(false)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={pending || unavailable || checking || targetVersion === null}
              onClick={() => {
                setConfirmUnknown(false)
                if (targetVersion !== null)
                  void updateSkill({ name, latestVersion: targetVersion, installedVersion: null })
              }}
            >
              {t('skill.updateConfirm')}
            </Button>
          </>
        )}
      >
        <p>{t('skill.updateConfirmHint')}</p>
      </Modal>
    </>
  )
}
