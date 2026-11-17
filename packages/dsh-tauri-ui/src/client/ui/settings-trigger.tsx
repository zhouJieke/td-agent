import type { EmployeeInfo, SessionId, SessionListState } from 'dsh-tauri/client'
import type { ReactElement } from 'react'
import type { SelectorHook } from '../types/selector'
import { cn, If, uniq, useAsyncState, useStore } from 'dsh-tauri/client'
import { useState } from 'react'
import { Button } from '../components/button'
import { ArrowRightFromSquare, Gear, Person } from '../components/icons'
import { SlotOutlet } from '../components/official'
import { SETTINGS_ONBOARDING_SLOT } from '../constants'
import { locale } from '../locales'
import { store } from '../store'

export type SessionListStateLike = Omit<SessionListState, 'byId'> & {
  current?: string
  byId: Record<string, SessionListState['byId'][SessionId]>
}

export interface SettingsTriggerProps {
  wide: boolean
  useSessions: SelectorHook<SessionListStateLike>
  useWorkspaces?: unknown
  getEmployee?: () => Promise<EmployeeInfo>
  signOut?: () => Promise<void>
}

export function SettingsTrigger({ wide, useSessions, getEmployee, signOut }: SettingsTriggerProps): ReactElement {
  const { open, launcherShortcut } = useStore(store.settings)
  const { onboarding } = useStore(store.sections)
  locale.useLocale()
  const [completed, setCompleted] = useState<string[]>([])
  const { state: employee, setState: setEmployee, execute: loadEmployee, isLoading: loadingEmployee, error: employeeError } = useAsyncState<EmployeeInfo | undefined>(async () => getEmployee?.(), undefined, { immediate: Boolean(getEmployee), onError: () => {} })
  const onboardingActive = useSessions((state) => {
    if (state.phase !== 'ready')
      return false
    if (state.current !== undefined)
      return state.byId[state.current]?.blank === true
    const main = Object.values(state.byId).find(session => (session.retainedBy?.mainView ?? 0) > 0)
    return main === undefined || main.blank === true
  })
  if (!onboardingActive && completed.length > 0)
    setCompleted([])
  const step = onboardingActive ? onboarding.find(s => !completed.includes(s.id)) : undefined
  const accountLabel = employee?.employeeName ?? locale.text('account')
  const { execute: handleSignOut, isLoading: signingOut, error: signOutError } = useAsyncState(async () => {
    if (!signOut)
      throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
    await signOut()
  }, undefined, {
    immediate: false,
    onSuccess: () => {
      setEmployee(undefined)
    },
    onError: () => {},
  })

  function completeStep(id: string) {
    setCompleted(previous => uniq([...previous, id]))
  }

  return (
    <>
      <div
        role="group"
        aria-label={accountLabel}
        aria-busy={loadingEmployee}
        className={cn(
          'box-border flex flex-none items-center gap-[8px] w-full h-[42px] my-[4px] pl-[8px] pr-[4px] [font-family:inherit] text-[14px] leading-[22px] text-primary',
          !wide && 'flex-col h-auto w-[36px] gap-[4px] mt-[8px] mb-[10px] p-0',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-[8px]" title={accountLabel}>
          <Person width={18} height={18} aria-hidden className="shrink-0" />
          <If cond={wide}><span className="min-w-0 flex-1 truncate text-left">{accountLabel}</span></If>
        </div>
        <div className={cn('ml-auto flex shrink-0 items-center gap-[4px]', !wide && 'ml-0 flex-col')}>
          <Button
            variant="ghost"
            size="md"
            className="size-[36px]! shrink-0 p-0!"
            aria-label={locale.text('settings')}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-keyshortcuts={launcherShortcut?.aria}
            title={locale.text('settings')}
            data-settings-trigger="dsh-tauri-ui"
            onClick={() => store.settings.openAt()}
          >
            <Gear width={16} height={16} aria-hidden className="shrink-0" />
          </Button>
          <Button
            variant="ghost"
            size="md"
            className="size-[36px]! shrink-0 p-0!"
            aria-label={locale.text('logout')}
            aria-busy={signingOut}
            title={locale.text('logout')}
            disabled={signingOut || !signOut}
            onClick={() => { void handleSignOut() }}
          >
            <ArrowRightFromSquare width={16} height={16} aria-hidden className="shrink-0 text-error" />
          </Button>
        </div>
      </div>
      <If cond={employeeError != null || signOutError != null}>
        <div className="flex flex-col gap-[8px] px-[8px] py-[4px] text-[13px] leading-[20px]">
          <If cond={employeeError != null}>
            <span className="text-error" role="alert">{locale.text('employeeFailed')}</span>
            <Button variant="link" disabled={loadingEmployee} onClick={() => { void loadEmployee() }}>{locale.text('retry')}</Button>
          </If>
          <If cond={signOutError != null}><span className="text-error" role="alert">{locale.text('logoutFailed')}</span></If>
        </div>
      </If>
      <If cond={step !== undefined}>
        <SlotOutlet
          slotKey={SETTINGS_ONBOARDING_SLOT}
          ownerProps={{
            stepId: step?.id,
            complete: () => {
              if (step)
                completeStep(step.id)
            },
            openSection: (id: string) => store.settings.openAt(id),
          }}
          opts={{ only: step?.id }}
        />
      </If>
    </>
  )
}
