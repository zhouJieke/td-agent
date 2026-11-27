import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Action, Button, Checkbox, Icon, Modal, SegmentedControl, Text, Textarea, Xmark } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { useState } from 'react'
import { closeSkillDetail } from '../service/skill'
import { store } from '../store'
import { MarkdownPreview } from './markdown'
import { SkillDownloadHints } from './skill-download'
import { SkillIcon } from './skill-icon'

export function SkillDetailModal({ t }: { t: Translate }): ReactElement {
  const [preview, setPreview] = useState(true)
  const detail = useStore(store.skill).detail

  return (
    <Modal
      headless
      open={detail !== null}
      onClose={closeSkillDetail}
      title={t('viewSkill')}
      className="w-[min(760px,100%)]! rounded-[28px]! p-0!"
    >
      {detail !== null && (
        <div className="flex min-h-0 flex-col gap-[24px] p-[24px]" style={{ maxHeight: 'calc(100dvh - 48px)' }}>
          <header className="flex shrink-0 items-start gap-[20px]">
            <SkillIcon name={detail.name} />
            <h2 className="m-0 min-w-0 flex-1 break-words text-primary text-[24px] leading-[32px] font-semibold">{detail.name}</h2>
            <Action variant="round" icon={<Icon as={Xmark} size={20} />} aria-label={t('close')} title={t('close')} onClick={closeSkillDetail} />
          </header>

          <div className="flex min-h-0 flex-col gap-[20px] overflow-y-auto">
            <section aria-label={t('skillDescription')}>
              <p className="m-0 whitespace-pre-wrap break-words text-primary text-[15px] leading-[24px]">{detail.description}</p>
            </section>
            <SkillDownloadHints t={t} name={detail.name} latestVersion={detail.latestVersion} />
            {detail.local
              ? (
                  <>
                    <section aria-label={t('skillWhenToUse')} className="flex flex-col gap-[8px]">
                      <h3 className="m-0 text-secondary text-[13px] leading-[20px] font-medium">{t('skillWhenToUse')}</h3>
                      <p className="m-0 whitespace-pre-wrap break-words text-primary text-[13px] leading-[20px]">{detail.whenToUse}</p>
                    </section>
                    <div className="flex items-center gap-[16px] flex-wrap">
                      <Checkbox checked={detail.modelInvocable} disabled onChange={() => {}}>{t('modelInvocable')}</Checkbox>
                      <Checkbox checked={detail.userInvocable} disabled onChange={() => {}}>{t('userInvocable')}</Checkbox>
                    </div>
                  </>
                )
              : detail.contentLoading
                ? null
                : <Text tone="tertiary" size="sm">{t('skill.detailNoLocal')}</Text>}
            {detail.contentLoading && <Text tone="tertiary" size="sm">{t('loading')}</Text>}
            {detail.local && (
              <div className="flex flex-col gap-[12px] text-secondary text-[12px] leading-[18px]">
                <div className="flex items-center gap-[6px] flex-wrap">
                  <span>{t('skillContent')}</span>
                  <span className="flex-1" />
                  <SegmentedControl
                    label={t('skillContent')}
                    value={preview ? 'preview' : 'text'}
                    options={[
                      { value: 'preview', label: t('skillPreview') },
                      { value: 'text', label: t('skillPlainText') },
                    ]}
                    onChange={next => setPreview(next === 'preview')}
                  />
                </div>
                {preview
                  ? <div className="border border-border-l2 rounded-[8px] px-[16px] py-[12px] bg-layer-1 text-[13px]"><MarkdownPreview text={detail.content} /></div>
                  : <Textarea value={detail.content} readOnly />}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 items-center justify-end">
            <Button variant="ghost" onClick={closeSkillDetail}>{t('close')}</Button>
          </footer>
        </div>
      )}
    </Modal>
  )
}
