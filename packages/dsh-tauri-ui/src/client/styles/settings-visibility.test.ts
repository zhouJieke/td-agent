// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountStyle } from '../utils/style'
import globalStyle, { GLOBAL_STYLE_ID } from './global.cssr'

const cleanups: Array<() => void> = []

beforeEach(() => {
  document.body.innerHTML = '<div id="frame"><div id="sidebar"><div data-slot="sidebar">Sessions</div></div><div id="main"><div data-slot="main">Home</div></div><div id="rightbar"><div data-slot="rightbar">Tools</div></div><div data-shell-overlay></div></div><div data-dsh-better-sidebar></div><div data-dsh-panel></div>'
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse())
    cleanup()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
})

function activate(): () => void {
  const dispose = mountStyle(globalStyle, GLOBAL_STYLE_ID)
  cleanups.push(dispose)
  return dispose
}

async function openSettings(): Promise<HTMLElement> {
  const dialog = document.createElement('section')
  dialog.setAttribute('data-slot-sidebar', 'dsh-tauri-ui')
  dialog.innerHTML = '<button>Back</button>'
  document.querySelector('[data-shell-overlay]')!.append(dialog)
  await flush()
  return dialog
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function expectUnderlay(display: string) {
  for (const selector of ['#sidebar', '#main', '#rightbar', '[data-dsh-better-sidebar]', '[data-dsh-panel]']) {
    const element = document.querySelector<HTMLElement>(selector)!
    expect(getComputedStyle(element).display, selector).toBe(display)
    if (display === 'none')
      expect(getComputedStyle(element).width, selector).toBe('0px')
  }
}

describe('设置关闭后的主界面可见性', () => {
  it('连续开合 100 次都恢复侧栏、主区与外部面板', async () => {
    activate()
    expectUnderlay('block')
    for (let index = 0; index < 100; index++) {
      const dialog = await openSettings()
      expectUnderlay('none')
      expect(getComputedStyle(dialog).display).toBe('block')
      expect(document.getElementById('main')!.getAttribute('style')).toBeNull()
      expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('')
      expect(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width')).toBe('0')
      dialog.remove()
      await flush()
      expectUnderlay('block')
    }
  })

  it('重复注册后关闭设置仍恢复全部主界面区域', async () => {
    activate()
    activate()
    const dialog = await openSettings()
    expectUnderlay('none')
    dialog.remove()
    await flush()
    expectUnderlay('block')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width')).toBe('')
  })

  it('设置打开时新旧实例交接不保留隐藏样式', async () => {
    const disposeOld = activate()
    const dialog = await openSettings()
    vi.resetModules()
    const [{ default: freshStyle }, { mountStyle: mountFreshStyle }] = await Promise.all([
      import('./global.cssr'),
      import('../utils/style'),
    ])
    cleanups.push(mountFreshStyle(freshStyle, GLOBAL_STYLE_ID))
    disposeOld()
    dialog.append(document.createElement('span'))
    await flush()
    expectUnderlay('none')
    dialog.remove()
    await flush()
    expectUnderlay('block')
  })

  it('只移除设置标记也会恢复主界面', async () => {
    activate()
    const dialog = await openSettings()
    expectUnderlay('none')
    dialog.removeAttribute('data-slot-sidebar')
    await flush()
    expectUnderlay('block')
  })

  it('设置期间的布局更新在关闭后保留', async () => {
    activate()
    const dialog = await openSettings()
    const main = document.getElementById('main')!
    main.style.width = '920px'
    main.style.display = 'flex'
    document.documentElement.style.setProperty('--dsh-sidebar-width', '320px')
    dialog.remove()
    await flush()
    expect(main.style.width).toBe('920px')
    expect(getComputedStyle(main).display).toBe('flex')
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('320px')
  })

  it('设置期间新挂载的外部面板随设置开合恢复', async () => {
    activate()
    const dialog = await openSettings()
    const panel = document.createElement('div')
    panel.setAttribute('data-dsh-panel', '')
    document.body.append(panel)
    await flush()
    expect(getComputedStyle(panel).display).toBe('none')
    dialog.remove()
    await flush()
    expect(getComputedStyle(panel).display).toBe('block')
  })
})
