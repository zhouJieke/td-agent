// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountStyle } from '../utils/style'
import globalStyle, { GLOBAL_STYLE_ID } from './global.cssr'
import settingsUnderlayStyle from './settings-underlay.cssr'

const cleanups: Array<() => void> = []

beforeEach(() => {
  document.body.innerHTML = '<style>html{--dsh-sidebar-width:280px}#sidebar{width:280px}#main{display:flex;width:840px}#rightbar{width:320px}</style><div id="frame"><div id="sidebar"><div data-slot="sidebar">Sessions</div></div><div id="main"><div data-slot="main">Home</div></div><div id="rightbar"><div data-slot="rightbar">Tools</div></div><div data-shell-overlay></div></div><div data-dsh-better-sidebar></div><div data-dsh-panel></div>'
  cleanups.push(mountStyle(globalStyle, GLOBAL_STYLE_ID))
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse())
    cleanup()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('style')
})

async function openSettings(css = settingsUnderlayStyle.render()): Promise<HTMLElement> {
  const dialog = document.createElement('section')
  dialog.setAttribute('data-slot-sidebar', 'dsh-tauri-ui')
  dialog.innerHTML = '<button>Back</button>'
  const style = document.createElement('style')
  style.textContent = css
  dialog.prepend(style)
  document.querySelector('[data-shell-overlay]')!.append(dialog)
  await flush()
  return dialog
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function expectUnderlay(visibility: string) {
  for (const selector of ['#sidebar', '#main', '#rightbar', '[data-dsh-better-sidebar]', '[data-dsh-panel]']) {
    const element = document.querySelector<HTMLElement>(selector)!
    expect(getComputedStyle(element).visibility, selector).toBe(visibility)
    expect(getComputedStyle(element).display, selector).not.toBe('none')
    expect(getComputedStyle(element).width, selector).not.toBe('0px')
    expect(getComputedStyle(element).pointerEvents, selector).toBe(visibility === 'hidden' ? 'none' : 'auto')
  }
}

describe('设置关闭后的主界面可见性', () => {
  it('连续开合 100 次都恢复侧栏、主区与外部面板', async () => {
    expectUnderlay('visible')
    for (let index = 0; index < 100; index++) {
      const dialog = await openSettings()
      expectUnderlay('hidden')
      expect(getComputedStyle(dialog).display).toBe('block')
      expect(getComputedStyle(dialog).visibility).toBe('visible')
      expect(getComputedStyle(document.getElementById('sidebar')!).width).toBe('280px')
      expect(getComputedStyle(document.getElementById('main')!).width).toBe('840px')
      expect(getComputedStyle(document.getElementById('rightbar')!).width).toBe('320px')
      expect(document.getElementById('main')!.getAttribute('style')).toBeNull()
      expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('')
      expect(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width')).toBe('280px')
      dialog.remove()
      await flush()
      expectUnderlay('visible')
    }
  })

  it('多个设置浮层关闭最后一层后才恢复主界面', async () => {
    const first = await openSettings()
    const dialog = await openSettings()
    first.remove()
    await flush()
    expectUnderlay('hidden')
    dialog.remove()
    await flush()
    expectUnderlay('visible')
    expect(getComputedStyle(document.documentElement).getPropertyValue('--dsh-sidebar-width')).toBe('280px')
  })

  it('设置打开时新旧实例交接不保留隐藏样式', async () => {
    const dialog = await openSettings()
    vi.resetModules()
    const { default: freshStyle } = await import('./settings-underlay.cssr')
    const freshDialog = await openSettings(freshStyle.render())
    dialog.remove()
    await flush()
    expectUnderlay('hidden')
    freshDialog.remove()
    await flush()
    expectUnderlay('visible')
  })

  it('移除遮蔽样式即恢复主界面，不依赖设置标记变化', async () => {
    const dialog = await openSettings()
    expectUnderlay('hidden')
    dialog.querySelector('style')!.remove()
    await flush()
    expectUnderlay('visible')
  })

  it('设置期间的布局更新在关闭后保留', async () => {
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
    const dialog = await openSettings()
    const panel = document.createElement('div')
    panel.setAttribute('data-dsh-panel', '')
    document.body.append(panel)
    await flush()
    expect(getComputedStyle(panel).display).toBe('block')
    expect(getComputedStyle(panel).visibility).toBe('hidden')
    dialog.remove()
    await flush()
    expect(getComputedStyle(panel).display).toBe('block')
    expect(getComputedStyle(panel).visibility).toBe('visible')
  })
})
