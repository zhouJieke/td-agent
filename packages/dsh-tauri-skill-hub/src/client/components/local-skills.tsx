import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import { Action, ArrowRotateRight, Button, Card, Checkbox, Field, GraduationCap, Icon, Input, LogoGithub, Modal, Pill, SegmentedControl, Switch, Tag, Text, Textarea } from 'dsh-tauri-ui/client'
import { orderBy, uniq, useMount, useStore } from 'dsh-tauri/client'
import { SOURCE_LOCALE_KEYS } from '../constants'
import { createLocalSkill, deleteLocalSkill, fetchLocalSkills, importLocalRepository, openLocalSkill, openLocalSkillDirectory, refreshLocalSkills, saveLocalSkill, toggleLocalSkill } from '../service/local-skills'
import { store } from '../store'
import { MarkdownPreview } from './markdown'
import { policyTag } from './skills-tab.utils'

export function LocalSkills({ t, createSkill, showHeaderActions }: { t: Translate, createSkill: () => Promise<void>, showHeaderActions: boolean }): ReactElement {
  const state = useStore(store.localSkills)
  useMount(() => {
    void fetchLocalSkills({ refresh: true })
  })

  const needle = state.query.trim().toLowerCase()
  const filtered = orderBy((state.skills ?? []).filter(skill =>
    (state.sourceFilter === 'all' || skill.source === state.sourceFilter)
    && (needle === '' || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)),
  ), [skill => skill.repository === undefined])
  const sources = state.skills === null ? [] : uniq(state.skills.map(skill => skill.source))
  const editor = state.editor
  const readOnly = editor?.mode === 'view'

  return (
    <div className="flex flex-col gap-[14px] text-primary">
      <div className="flex items-center gap-[10px] flex-wrap [&_h3]:m-0 [&_h3]:text-[16px] [&_h3]:leading-[24px] [&_h3]:font-medium">
        <span className="inline-flex items-center justify-center flex-none w-[22px] h-[22px]"><Icon as={GraduationCap} size={16} /></span>
        <h3>{t('skillsTitle')}</h3>
        {showHeaderActions && (
          <>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={() => void openLocalSkillDirectory({ target: 'user-skills' })}>{t('openUserSkills')}</Button>
            <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => store.localSkills.setImportOpen(true)}>{t('importRepository')}</Button>
            <Button variant="primary" size="sm" disabled={state.busy} onClick={() => void createLocalSkill(createSkill)}>{t('newSkill')}</Button>
          </>
        )}
      </div>
      <Text tone="tertiary">{t('skillsIntro')}</Text>
      {state.error !== '' && <Text tone="error" size="sm" role="alert">{`${t('feedback.failed')}: ${state.error}`}</Text>}
      <div className="flex items-center gap-[7px] px-[2px] mt-[2px] [&_h3]:m-0 [&_h3]:text-[13px] [&_h3]:leading-[20px] [&_h3]:font-semibold">
        <h3>{t('skillsTab')}</h3>
        {state.skills !== null && (
          <span className="text-[12px] leading-[18px] text-tertiary tabular-nums">
            {filtered.length}
            /
            {state.skills.length}
          </span>
        )}
        <span className="flex-1" />
        <Input className="w-[200px] max-[680px]:w-[140px]" type="search" placeholder={t('searchSkills')} aria-label={t('searchSkills')} value={state.query} onChange={event => store.localSkills.setQuery(event.target.value)} />
        <Action variant="toolbar" icon={<Icon as={ArrowRotateRight} />} aria-label={t('refresh')} title={t('refresh')} disabled={state.busy} onClick={() => void refreshLocalSkills()} />
      </div>
      {sources.length > 1 && (
        <div className="flex items-center gap-[6px] flex-wrap" role="group" aria-label={t('source')}>
          {[{ id: 'all', label: t('filterAll') }, ...sources.map(source => ({ id: source, label: t(SOURCE_LOCALE_KEYS[source] ?? 'sourceCustom') }))].map(chip => (
            <Pill key={chip.id} active={state.sourceFilter === chip.id} onClick={() => store.localSkills.setSourceFilter(chip.id)}>{chip.label}</Pill>
          ))}
        </div>
      )}
      {state.skills === null && state.loading && <Text size="sm" tone="tertiary">{t('loading')}</Text>}
      {state.skills !== null && filtered.length === 0 && <Text size="sm" tone="tertiary">{state.skills.length === 0 ? t('emptySkills') : t('noMatch')}</Text>}
      {filtered.length > 0 && (
        <Card.List className="grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-[10px] max-[680px]:grid-cols-[minmax(0,1fr)]">
          {filtered.map((skill) => {
            const tag = policyTag(skill)
            const githubUrl = skill.repository?.githubUrl
            const safeGithubUrl = githubUrl !== undefined && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\/tree\/[\w.%/-]+)?$/i.test(githubUrl)
              ? githubUrl
              : undefined
            return (
              <Card key={`${skill.source}/${skill.name}`} className="mx-0 flex flex-col gap-[8px] px-[14px] py-[12px]">
                <div className="flex items-center gap-[6px] flex-wrap">
                  <Card.Title className="flex-1 min-w-0 font-semibold [font-family:var(--ds-font-family-code)]" title={skill.name}>{skill.name}</Card.Title>
                  <Tag tone="info">{t(SOURCE_LOCALE_KEYS[skill.source] ?? 'sourceCustom')}</Tag>
                  {tag.key && <Tag tone={tag.off ? 'warning' : 'neutral'}>{t(tag.key)}</Tag>}
                </div>
                <Card.Description className="text-secondary line-clamp-2" title={skill.description}>{skill.description}</Card.Description>
                <div className="flex items-center gap-[6px] flex-wrap">
                  {skill.policyEditable && <Switch checked={skill.invocation.modelInvocable || skill.invocation.userInvocable} onChange={() => void toggleLocalSkill(skill)} label={t('toggleSkill')} title={t('toggleSkillHint')} disabled={state.busy} />}
                  {skill.dir && <Button variant="ghost" size="sm" onClick={() => void openLocalSkillDirectory({ target: 'skill', name: skill.name })}>{t('openFolder')}</Button>}
                  <span className="flex-1" />
                  {safeGithubUrl !== undefined && <Action variant="toolbar" icon={<Icon as={LogoGithub} />} aria-label={t('githubRepository')} title={t('githubRepository')} onClick={() => window.open(safeGithubUrl, '_blank', 'noopener,noreferrer')} />}
                  <Button variant="ghost" size="sm" disabled={state.busy} onClick={() => void openLocalSkill(skill)}>{skill.editable ? t('edit') : t('view')}</Button>
                  {skill.removable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={state.busy}
                      onClick={() => {
                        store.localSkills.setFormError('')
                        store.localSkills.setConfirmName(skill.name)
                      }}
                    >
                      {t('delete')}
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </Card.List>
      )}
      <Modal open={editor !== null} onClose={() => store.localSkills.setEditor(null)} closeLabel={t('close')} title={editor?.mode === 'edit' ? t('editSkill') : t('viewSkill')} className="w-[min(760px,100%)]!" contentClassName="max-h-[calc(100vh-160px)]! overflow-y-auto">
        {editor && (
          <div className="flex flex-col gap-[10px]">
            <Field label={t('skillName')}>
              <Input value={editor.name} disabled />
            </Field>
            <Field label={t('skillDescription')}>
              <Input value={editor.description} disabled={readOnly} onChange={event => store.localSkills.setEditor({ ...editor, description: event.target.value })} />
            </Field>
            <Field label={t('skillWhenToUse')}>
              <Input value={editor.whenToUse} disabled={readOnly} onChange={event => store.localSkills.setEditor({ ...editor, whenToUse: event.target.value })} />
            </Field>
            <div className="flex items-center gap-[16px] flex-wrap">
              <Checkbox checked={editor.modelInvocable} disabled={readOnly} onChange={next => store.localSkills.setEditor({ ...editor, modelInvocable: next })}>{t('modelInvocable')}</Checkbox>
              <Checkbox checked={editor.userInvocable} disabled={readOnly} onChange={next => store.localSkills.setEditor({ ...editor, userInvocable: next })}>{t('userInvocable')}</Checkbox>
            </div>
            <div className="flex flex-col gap-[4px] text-[12px] leading-[18px] text-secondary [&>span:first-child]:text-tertiary">
              <div className="flex items-center gap-[6px] flex-wrap">
                <span>{t('skillContent')}</span>
                <span className="flex-1" />
                <SegmentedControl
                  label={t('skillContent')}
                  value={state.preview ? 'preview' : 'text'}
                  options={[
                    { value: 'preview', label: t('skillPreview') },
                    { value: 'text', label: readOnly ? t('skillPlainText') : t('edit') },
                  ]}
                  onChange={next => store.localSkills.setPreview(next === 'preview')}
                />
              </div>
              {state.preview
                ? <div className="min-h-[320px] max-h-[60vh] overflow-y-auto border border-border-l2 rounded-[8px] px-[12px] py-[8px] bg-layer-1 text-[13px]"><MarkdownPreview text={editor.content} /></div>
                : <Textarea value={editor.content} readOnly={readOnly} onChange={event => store.localSkills.setEditor({ ...editor, content: event.target.value })} />}
            </div>
            {state.formError !== '' && <Text tone="error" role="alert">{state.formError}</Text>}
            <div className="flex items-center gap-[6px] flex-wrap">
              <span className="flex-1" />
              <Button variant="ghost" onClick={() => store.localSkills.setEditor(null)}>{readOnly ? t('close') : t('cancel')}</Button>
              {!readOnly && <Button variant="primary" disabled={state.busy} onClick={() => void saveLocalSkill()}>{t('save')}</Button>}
            </div>
          </div>
        )}
      </Modal>
      <Modal
        open={state.confirmName !== null}
        onClose={() => store.localSkills.setConfirmName(null)}
        closeLabel={t('close')}
        title={t('confirmDelete')}
        description={state.confirmName ?? undefined}
        footer={(
          <>
            <Button variant="ghost" onClick={() => store.localSkills.setConfirmName(null)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={state.busy} onClick={() => void deleteLocalSkill()}>{t('delete')}</Button>
          </>
        )}
      >
        <p>{t('deleteWarn')}</p>
        {state.formError !== '' && <Text tone="error" role="alert">{state.formError}</Text>}
      </Modal>
      <Modal open={showHeaderActions && state.importOpen} onClose={() => store.localSkills.setImportOpen(false)} closeLabel={t('close')} title={t('importRepositoryTitle')} className="w-[min(680px,100%)]!">
        <div className="flex flex-col gap-[10px]">
          <Text tone="tertiary">{t('importRepositoryHint')}</Text>
          <Field label={t('repository')}>
            <Input
              autoFocus
              placeholder={t('importRepositoryPlaceholder')}
              value={state.repositoryUrl}
              onChange={event => store.localSkills.setRepositoryUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !state.busy)
                  void importLocalRepository()
              }}
            />
          </Field>
          {state.formError !== '' && <Text tone="error" role="alert">{state.formError}</Text>}
          <div className="flex items-center gap-[6px] flex-wrap">
            <span className="flex-1" />
            <Button variant="ghost" disabled={state.busy} onClick={() => store.localSkills.setImportOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" disabled={state.busy || state.repositoryUrl.trim() === ''} onClick={() => void importLocalRepository()}>{t('importRepository')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
