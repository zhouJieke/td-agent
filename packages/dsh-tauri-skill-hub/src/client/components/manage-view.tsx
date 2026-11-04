import type { ReactElement } from 'react'
import type { Translate } from '../locales/index.types'
import type { EmployeeDeptVO, SkillSummary } from '../types'
import { Button, Checkbox, Icon, Input, Magnifier, Person, Select, Tag, Text } from 'dsh-tauri-ui/client'
import { difference, isEmpty, uniq, useStore } from 'dsh-tauri/client'
import { useState } from 'react'
import { saveUserSkillNames, selectManageUser } from '../service/skill'
import { store } from '../store'
import { employeeLabel, filterSummaries, findEmployee, skillTitle, sortSummaries } from '../store/modules/skill.utils'

interface ManageViewProps {
  t: Translate
}

/** 管理页：选择员工并整份覆盖保存其技能名单。 */
export function ManageView({ t }: ManageViewProps): ReactElement {
  const state = useStore(store.skill)
  const [selected, setSelected] = useState<string[]>(() => [...state.manageMine?.skillNames ?? []])
  const [lastMine, setLastMine] = useState(state.manageMine)
  const [pending, setPending] = useState(false)
  if (lastMine !== state.manageMine) {
    setLastMine(state.manageMine)
    setSelected([...state.manageMine?.skillNames ?? []])
  }
  const keyword = state.keyword
  const candidates = filterSummaries(sortSummaries(state.catalog), keyword)
  const employee = state.employee
  const target = findEmployee(state.employees, state.manageUserId)
  const options = state.employees.length === 0 && employee !== null
    ? [{ value: employee.employeeNumber, label: `${employee.employeeName}${isEmpty(state.profile?.departmentName ?? '') ? '' : ` · ${state.profile?.departmentName}`}` }]
    : state.employees.map((item: EmployeeDeptVO) => ({ value: item.userId, label: employeeLabel(item, item.userId) }))

  async function submit(): Promise<void> {
    if (isEmpty(state.manageUserId))
      return
    setPending(true)
    await saveUserSkillNames(state.manageUserId, selected)
    setPending(false)
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <Select
          label={t('manage.user')}
          icon={<Icon as={Person} />}
          value={state.manageUserId}
          options={options}
          onChange={id => void selectManageUser(id)}
        />
        {target?.departmentName == null ? null : <Tag tone="quiet">{target.departmentName}</Tag>}
        <Input
          className="min-w-0 flex-[1_1_220px] max-w-[320px]"
          type="search"
          icon={<Icon as={Magnifier} />}
          aria-label={t('search.aria')}
          placeholder={t('search.placeholder')}
          value={keyword}
          onChange={event => store.skill.setKeyword(event.target.value)}
        />
      </div>

      <p className="m-0 text-secondary text-[13px] leading-[20px]">{t('manage.hint')}</p>

      {state.manageLoading
        ? <Text tone="tertiary" size="sm" className="py-[24px] text-center">{t('loading')}</Text>
        : candidates.length === 0
          ? <Text tone="tertiary" size="sm" className="py-[24px] text-center">{isEmpty(keyword) ? t('manage.empty') : t('list.emptyMatch')}</Text>
          : (
              <div className="max-h-[48vh] overflow-auto rounded-lg border border-border-l2">
                {candidates.map((item: SkillSummary) => (
                  <div
                    key={`${item.namespaceId}/${item.name}`}
                    className="flex items-start gap-[8px] px-[10px] py-[8px] border-b border-border-l2 last:border-b-0 hover:bg-hover"
                  >
                    <Checkbox
                      size="xs"
                      checked={selected.includes(item.name)}
                      aria-label={skillTitle(item)}
                      onChange={next => setSelected(value => (next ? uniq([...value, item.name]) : difference(value, [item.name])))}
                    />
                    <span className="flex flex-col gap-[2px] min-w-0">
                      <span className="flex flex-wrap items-center gap-[6px]">
                        <span className="text-primary text-[13px] leading-[20px]">{skillTitle(item)}</span>
                        <span className="font-mono text-tertiary text-[12px] leading-[18px]">{item.name}</span>
                        {item.labels.latest === undefined ? null : <Tag variant="version" tone="outline">{item.labels.latest}</Tag>}
                        <Tag tone={item.enable ? 'success' : 'neutral'}>{item.enable ? t('status.enabled') : t('status.disabled')}</Tag>
                      </span>
                      <span className="text-tertiary text-[12px] leading-[18px]">{item.description ?? t('skill.noDescription')}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

      <div className="flex items-center justify-between gap-[8px]">
        <span className="text-tertiary text-[12px] leading-[18px] tabular-nums">{t('manage.selected', { count: selected.length })}</span>
        <div className="flex items-center gap-[8px]">
          {selected.length === 0 ? <Text tone="tertiary" size="xs">{t('manage.emptyWarn')}</Text> : null}
          <Button variant="add" disabled={pending || state.manageLoading || selected.length === 0} onClick={() => void submit()}>
            {t('manage.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
