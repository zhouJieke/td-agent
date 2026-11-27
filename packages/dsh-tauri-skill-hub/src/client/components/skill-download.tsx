import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Action, ArrowRotateRight, Button, Check, Icon, Modal, Plus, Text, TriangleExclamation } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { useState } from 'react'
import { downloadSkill, updateSkill } from '../service/skill'
import { store } from '../store'
import { installedSkillVersion, isNewerSkillVersion, isSkillVersion } from '../store/modules/skill.utils'

interface SkillDownloadProps {
  t: Translate
  name: string
  latestVersion?: string
}

function useSkillDownload({ t, name, latestVersion }: SkillDownloadProps) {
  const state = useStore(store.skill)
  const [confirmUnknown, setConfirmUnknown] = useState(false)
  const installed = state.installedNames.includes(name)
  const pending = state.downloading.includes(name)
  const unavailable = state.installedError !== ''
  const checking = state.installedLoading || !state.installedChecked
  const localVersion = installedSkillVersion(state.installedVersions, name)
  const knownLocal = isSkillVersion(localVersion)
  const targetVersion = isSkillVersion(latestVersion) ? latestVersion : null
  const updatable = state.updatableNames.includes(name)
  const canUpdate = installed && updatable && targetVersion !== null
    && (!knownLocal || isNewerSkillVersion(targetVersion, localVersion))
  const busy = pending || unavailable || checking
  const label = installed
    ? t('skill.downloadedAria', { name })
    : pending
      ? t('skill.downloadingAria', { name })
      : unavailable
        ? t('skill.statusUnavailableAria', { name })
        : checking
          ? t('skill.checkingAria', { name })
          : t('skill.downloadAria', { name })
  const updateLabel = pending ? t('skill.updatingAria', { name }) : t('skill.updateAria', { name })

  return {
    busy,
    canUpdate,
    confirmUnknown,
    knownLocal,
    label,
    installed,
    localVersion,
    setConfirmUnknown,
    targetVersion,
    unavailable,
    updatable,
    updateLabel,
  }
}

export function SkillDownloadAction({ t, name, latestVersion, className }: SkillDownloadProps & { className?: string }): ReactElement {
  const d = useSkillDownload({ t, name, latestVersion })
  const { canUpdate, knownLocal, localVersion, targetVersion } = d

  return (
    <>
      <Action
        variant="toolbar"
        className={className}
        icon={<Icon as={d.installed ? Check : d.unavailable ? TriangleExclamation : Plus} />}
        aria-label={d.label}
        title={d.label}
        disabled={d.busy || d.installed}
        onClick={() => void downloadSkill(name)}
      />
      {canUpdate && targetVersion !== null && (
        <Action
          variant="toolbar"
          className={className}
          icon={<Icon as={ArrowRotateRight} />}
          aria-label={d.updateLabel}
          title={d.updateLabel}
          disabled={d.busy}
          onClick={() => {
            if (!knownLocal)
              d.setConfirmUnknown(true)
            else
              void updateSkill({ name, latestVersion: targetVersion, installedVersion: localVersion ?? null })
          }}
        />
      )}
      <Modal
        open={d.confirmUnknown}
        onClose={() => d.setConfirmUnknown(false)}
        closeLabel={t('close')}
        title={t('skill.updateConfirmTitle')}
        description={name}
        footer={(
          <>
            <Button variant="ghost" onClick={() => d.setConfirmUnknown(false)}>{t('cancel')}</Button>
            <Button
              variant="primary"
              disabled={d.busy || d.targetVersion === null}
              onClick={() => {
                d.setConfirmUnknown(false)
                if (d.targetVersion !== null)
                  void updateSkill({ name, latestVersion: d.targetVersion, installedVersion: null })
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

export function SkillDownloadHints({ t, name, latestVersion }: SkillDownloadProps): ReactElement | null {
  const d = useSkillDownload({ t, name, latestVersion })
  const hints = [
    d.installed && !d.knownLocal ? t('skill.localVersionUnknown') : null,
    d.installed && d.targetVersion === null ? t('skill.remoteVersionUnknown') : null,
    d.installed && !d.updatable ? t('skill.updateUnsafe') : null,
  ].filter((hint): hint is string => hint !== null)

  if (hints.length === 0)
    return null

  return (
    <>
      {hints.map(hint => <Text key={hint} tone="tertiary" size="xs">{hint}</Text>)}
    </>
  )
}

export function SkillDownload(props: SkillDownloadProps): ReactElement {
  return (
    <>
      <SkillDownloadAction {...props} />
      <SkillDownloadHints {...props} />
    </>
  )
}
