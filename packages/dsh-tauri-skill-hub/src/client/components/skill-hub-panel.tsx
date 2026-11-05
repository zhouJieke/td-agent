import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { SkillFeedback } from '../store/modules/skill.types'
import { Button, Icon, Panel, Person, SegmentedControl, Text, Toast, TriangleExclamation } from 'dsh-tauri-ui/client'
import { isEmpty, useStore, useWatchImmediate } from 'dsh-tauri/client'
import { PLUGIN_ID } from '../constants'
import { loadSkillHub } from '../service/skill'
import { store } from '../store'
import { toTab } from '../store/modules/skill.utils'
import { MineView } from './mine-view'
import { SkillCatalog } from './skill-catalog'

const TABS_ID = `${PLUGIN_ID}.tabs`

function feedbackText(feedback: SkillFeedback, t: Translate): string {
  switch (feedback.kind) {
    case 'saved':
      return t('feedback.saved', { name: feedback.name, count: feedback.count })
    case 'uploaded':
      return t('feedback.uploaded', { name: feedback.skillName, version: feedback.version })
    case 'failed':
      return `${t('feedback.failed')}: ${feedback.error}`
  }
}

export function SkillHubPanel({ t }: { t: Translate }): ReactElement {
  const state = useStore(store.skill)
  const displayName = state.profile?.employeeName ?? state.employee?.employeeName ?? ''
  const activeTab = state.tab === 'mine' ? 'mine' : 'enterprise'
  useWatchImmediate([state.tab], () => {
    void loadSkillHub()
  })

  return (
    <Panel>
      <div className="box-border flex flex-col gap-[16px] font-sans text-primary text-[13px] leading-[1.5]">
        <header className="flex items-start justify-between gap-[16px]">
          <div className="min-w-0">
            <h1 className="m-0 text-[20px] leading-[28px] font-medium">{t('skillHub')}</h1>
            <p className="mt-[4px] mx-0 mb-0 text-secondary text-[13px] leading-[20px]">{t('subtitle')}</p>
          </div>
          <div className="flex flex-none items-center gap-[8px]">
            <span className="flex items-center gap-[6px] text-secondary text-[13px] leading-[20px]">
              <Icon as={Person} size={14} />
              {state.employee === null ? t('auth.notSignedIn') : `${state.employee.employeeName} · ${state.employee.employeeNumber}`}
            </span>
          </div>
        </header>

        {!state.authChecked
          ? <Text tone="tertiary" size="sm">{t('loading')}</Text>
          : state.employee === null
            ? (
                <div className="flex flex-col items-start gap-[12px] rounded-lg border border-border-l2 bg-layer-3 px-[16px] py-[20px]">
                  <span className="font-medium text-primary text-[15px] leading-[22px]">{t('auth.title')}</span>
                  <p className="m-0 text-secondary leading-[20px]">{t('auth.hint')}</p>
                  <Button variant="add" onClick={() => void loadSkillHub()}>{t('auth.retry')}</Button>
                </div>
              )
            : (
                <>
                  {isEmpty(state.error) ? null : <Text tone="error" size="sm" role="alert">{state.error}</Text>}

                  <div className="flex items-center border-b-[0.5px] border-border-l3">
                    <SegmentedControl
                      id={TABS_ID}
                      variant="underline"
                      label={t('tabs.aria')}
                      value={activeTab}
                      options={[
                        { value: 'enterprise', label: t('tab.enterprise') },
                        { value: 'mine', label: t('tab.mine') },
                      ]}
                      onChange={(next) => {
                        const tab = toTab(next)
                        if (tab === state.tab)
                          return
                        store.skill.setTab(tab)
                      }}
                    />
                  </div>

                  <div id={`${TABS_ID}-${activeTab}-panel`} role="tabpanel" className="min-w-0">
                    {state.loading && state.common.length === 0
                      ? <Text tone="tertiary" size="sm">{t('loading')}</Text>
                      : activeTab === 'mine'
                        ? (
                            <MineView
                              t={t}
                              mine={state.mine}
                              hint={t('mine.hint', { name: displayName })}
                              emptyText={t('mine.empty')}
                            />
                          )
                        : (
                            <SkillCatalog
                              t={t}
                              hint={t('enterprise.hint')}
                              skills={state.common}
                              emptyText={t('enterprise.empty')}
                            />
                          )}
                  </div>
                </>
              )}

        {state.feedback === null
          ? null
          : (
              <Toast
                key={state.feedback.seq}
                tone={state.feedback.kind === 'failed' ? undefined : 'success'}
                icon={state.feedback.kind === 'failed' ? <Icon as={TriangleExclamation} size={16} /> : undefined}
                text={feedbackText(state.feedback, t)}
                onDone={() => store.skill.dismissFeedback(state.feedback?.seq)}
              />
            )}
      </div>
    </Panel>
  )
}
