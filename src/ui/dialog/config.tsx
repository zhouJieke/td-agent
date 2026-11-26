import type { PropsWithOverlays } from '@overlastic/react'
import { Brush, HardDrive, LogoWindows } from '@gravity-ui/icons'
import { cn, Modal } from '@heroui/react'
import { useDisclosure } from '@overlastic/react'
import { useListener } from '@reause/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Case, Switch } from 'react-if-lite'
import { hooks } from '@/config/hooks'
import { ConfigAppearance } from '@/ui/config/appearance'
import { ConfigDataDir } from '@/ui/config/data-dir'
import { ConfigDebug } from '@/ui/config/debug'

/** 配置面板标识（左侧导航与顶部「配置」菜单共用同一组值） */
export type ConfigTab = 'appearance' | 'application' | 'dataDir'

export interface ConfigDialogProps extends PropsWithOverlays {
  /** 打开时定位到的面板；缺省为「应用」 */
  tab?: ConfigTab
}

export function ConfigDialog(props: ConfigDialogProps) {
  const disclosure = useDisclosure({ props })
  const { t } = useTranslation()

  const navs: { label: string, value: ConfigTab, icon: typeof LogoWindows }[] = [
    { label: t('config.application'), value: 'application', icon: LogoWindows },
    { label: t('config.appearance'), value: 'appearance', icon: Brush },
    { label: t('config.dataDir'), value: 'dataDir', icon: HardDrive },
  ]

  const [activeTab, setActiveTab] = useState<ConfigTab>(props.tab ?? 'application')

  // 服务重启/退出前由 store 触发，命令式收起本对话框（卸载时自动注销）
  useListener(hooks['config.dialog.hidden'].on, disclosure.cancel)

  return (
    <Modal isOpen={disclosure.visible} onOpenChange={disclosure.cancel}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog data-testid="dsh-config-dialog" className="w-[840px] max-w-[calc(100vw-48px)] h-[min(720px,calc(100vh-96px))] pr-2.5">
            <Modal.CloseTrigger data-testid="dsh-config-dialog-close" />
            <Modal.Header className="mb-3">
              <Modal.Heading>
                {t('app.config')}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex gap-6 pr-0">
              <aside className="w-[164px]">
                <nav className="flex flex-col gap-2 w-full">
                  {navs.map((item) => {
                    const isActive = item.value === activeTab
                    return (
                      <button
                        key={item.value}
                        data-testid={`dsh-config-nav-${item.value}`}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={() => setActiveTab(item.value)}
                        className={cn(
                          'text-foreground h-[40px] rounded-md flex items-center gap-2 py-[9px] px-[16px] hover:bg-background-secondary cursor-pointer',
                          isActive ? 'bg-background-secondary' : '',
                        )}
                      >
                        <item.icon className="w-5 h-5 mr-2" />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </nav>
              </aside>
              <div data-testid="dsh-config-panel-body" className="flex flex-col flex-1 overflow-auto min-h-0 pr-2.5 px-1">
                <Switch value={activeTab} as="div">
                  <Case cond="application">
                    <ConfigDebug />
                  </Case>
                  <Case cond="appearance">
                    <ConfigAppearance />
                  </Case>
                  <Case cond="dataDir">
                    <ConfigDataDir />
                  </Case>
                </Switch>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
