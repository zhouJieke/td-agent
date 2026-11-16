// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpIcon } from './mcp-icon'

vi.mock('dsh-tauri-ui/client', () => ({
  Icon: ({ as: _as }: { as: unknown }) => <svg />,
  PlugConnection: 'plug',
  TerminalLine: 'terminal',
}))

afterEach(() => cleanup())

describe('MCP 目录图标', () => {
  it('有图标地址时渲染图片', () => {
    const view = render(<McpIcon name="高德地图 MCP" transport="streamable-http" iconUrl="https://cdn.example.test/a.png" />)
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example.test/a.png')
  })

  it('图片加载失败后回落到名称首字母', () => {
    const view = render(<McpIcon name="mcd-mcp" transport="streamable-http" iconUrl="https://cdn.example.test/broken.png" />)
    const image = view.container.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.error(image!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toBe('M')
  })

  it('没有图标地址时直接用首字母，名称为空才退回传输方式图标', () => {
    const letter = render(<McpIcon name=" amap-maps" transport="streamable-http" />)
    expect(letter.container.textContent).toBe('A')
    const plate = render(<McpIcon name="   " transport="stdio" />)
    expect(plate.container.querySelector('svg')).not.toBeNull()
  })
})
