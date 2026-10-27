import type { EmployeeInfo, SessionId, SessionListState } from 'dsh-tauri/client'
import type { ReactElement } from 'react'
import type { SelectorHook } from '../types/selector'
import { cn, If, uniq, useAsyncState, useStore, useWatchImmediate } from 'dsh-tauri/client'
import { useState } from 'react'
import { Button } from '../components/button'
import { ArrowRightFromSquare, Gear, Person } from '../components/icons'
import { Menu, SlotOutlet } from '../components/official'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const { state: employee, setState: setEmployee, execute: loadEmployee, isLoading: loadingEmployee, error: employeeError } = useAsyncState<EmployeeInfo | undefined>(async () => getEmployee?.(), undefined, { immediate: false, onError: () => {} })
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
  const menuItems = [{ id: 'settings', label: locale.text('settings'), icon: <Gear width={16} height={16} />, shortcut: launcherShortcut }]
  const { execute: handleSignOut, isLoading: signingOut, error: signOutError } = useAsyncState(async () => {
    if (!signOut)
      throw new Error('DESKTOP_AUTH_NATIVE_REQUIRED')
    await signOut()
  }, undefined, {
    immediate: false,
    onSuccess: () => {
      setEmployee(undefined)
      setMenuOpen(false)
    },
    onError: () => {},
  })

  useWatchImmediate([menuOpen], () => {
    if (menuOpen && getEmployee)
      void loadEmployee()
  })

  function completeStep(id: string) {
    setCompleted(previous => uniq([...previous, id]))
  }

  const trigger = (
    <button
      type="button"
      aria-label={locale.text('more')}
      aria-haspopup="menu"
      aria-expanded={open || menuOpen}
      onClick={() => setMenuOpen(value => !value)}
      data-settings-trigger="dsh-tauri-ui"
      className={cn(
        'box-border flex flex-none items-center gap-[8px] w-[calc(100%+4px)] h-[42px] my-[4px] -mx-[2px] pr-[10px] pl-[8px] border-none rounded-[12px] bg-transparent [font-family:inherit] text-[14px] leading-[22px] text-primary overflow-hidden cursor-pointer hover:bg-hover',
        !wide && 'justify-center gap-0 w-[36px] h-[36px] mt-[8px] mb-[10px] mx-0 p-0 rounded-full',
      )}
    >
      <Gear width={18} height={18} aria-hidden className="shrink-0" />
      <If cond={wide}><span>{locale.text('more')}</span></If>
    </button>
  )

  return (
    <>
      <Menu
        open={menuOpen}
        side="top"
        align="start"
        portal
        autoFocus
        className="block! w-full!"
        items={menuItems}
        footer={[{ id: 'logout', label: locale.text('logout'), icon: <ArrowRightFromSquare width={16} height={16} aria-hidden />, danger: true, disabled: signingOut || !signOut }]}
        anchor={trigger}
        onSelect={(id: string) => {
          if (id === 'logout') {
            void handleSignOut()
            return
          }
          setMenuOpen(false)
          if (id === 'settings')
            store.settings.openAt()
        }}
        onClose={() => setMenuOpen(false)}
      >
        <div className="flex flex-col gap-[8px] border-t border-border-l3 px-[8px] py-[8px]" style={{ minWidth: 240, maxWidth: 320 }}>
          <If cond={employee !== undefined || loadingEmployee || !getEmployee}>
            <div className="flex items-center gap-[6px]">
              <Person width={14} height={14} aria-hidden className="shrink-0 text-secondary" />
              <div className="min-w-0 flex-1">
                <If cond={employee !== undefined}>
                  <div className="flex min-w-0 flex-wrap items-center gap-[8px] text-[13px] leading-[20px]">
                    <span className="min-w-0 max-w-full break-all font-medium">{employee?.employeeName}</span>
                    <span className="min-w-0 max-w-full break-all text-[12px] text-secondary">{employee?.employeeNumber}</span>
                  </div>
                </If>
                <If cond={loadingEmployee}><span role="status">{locale.text('employeeLoading')}</span></If>
                <If cond={!getEmployee}><span>{locale.text('notSignedIn')}</span></If>
              </div>
            </div>
          </If>
          <If cond={employeeError != null}>
            <span className="text-error" role="alert">{locale.text('employeeFailed')}</span>
            <Button variant="link" role="menuitem" disabled={loadingEmployee} onClick={() => { void loadEmployee() }}>{locale.text('retry')}</Button>
          </If>
          <If cond={signOutError != null}><span className="text-error" role="alert">{locale.text('logoutFailed')}</span></If>
        </div>
      </Menu>
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
