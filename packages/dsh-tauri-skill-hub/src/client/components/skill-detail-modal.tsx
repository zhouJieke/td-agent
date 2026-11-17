import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Button, Checkbox, Field, Input, Modal, SegmentedControl, Text, Textarea } from 'dsh-tauri-ui/client'
import { useStore } from 'dsh-tauri/client'
import { useState } from 'react'
import { closeSkillDetail } from '../service/skill'
import { store } from '../store'
import { MarkdownPreview } from './markdown'

/** 企业/我的技能的只读详情弹窗：版式对齐本地技能编辑器，仅展示、不提供保存。 */
export function SkillDetailModal({ t }: { t: Translate }): ReactElement {
  const [preview, setPreview] = useState(true)
  const detail = useStore(store.skill).detail

  return (
    <Modal
      open={detail !== null}
      onClose={closeSkillDetail}
      closeLabel={t('close')}
      title={t('viewSkill')}
      className="w-[min(760px,100%)]!"
      contentClassName="max-h-[calc(100vh-160px)]! overflow-y-auto"
    >
      {detail !== null && (
        <div className="flex flex-col gap-[10px]">
          <Field label={t('skillName')}>
            <Input value={detail.name} disabled />
          </Field>
          <Field label={t('skillDescription')}>
            <Input value={detail.description} disabled />
          </Field>
          {detail.local
            ? (
                <>
                  <Field label={t('skillWhenToUse')}>
                    <Input value={detail.whenToUse} disabled />
                  </Field>
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
            <div className="flex flex-col gap-[4px] text-[12px] leading-[18px] text-secondary [&>span:first-child]:text-tertiary">
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
                ? <div className="min-h-[320px] max-h-[60vh] overflow-y-auto border border-border-l2 rounded-[8px] px-[12px] py-[8px] bg-layer-1 text-[13px]"><MarkdownPreview text={detail.content} /></div>
                : <Textarea value={detail.content} readOnly />}
            </div>
          )}
          <div className="flex items-center gap-[6px] flex-wrap">
            <span className="flex-1" />
            <Button variant="ghost" onClick={closeSkillDetail}>{t('close')}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
