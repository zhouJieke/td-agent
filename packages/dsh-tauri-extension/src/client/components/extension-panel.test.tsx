// @vitest-environment jsdom
import type { SegmentedControlProps } from '../../../../dsh-tauri-ui/src/client/components/segmented-control'
import { cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionPanel } from './extension-panel'

vi.mock('dsh-tauri-ui/client', () => ({
  SegmentedControl: ({ options, value, onChange }: SegmentedControlProps) => (
    <nav data-active={value}>
      {options.map(option => <button key={option.value} type="button" onClick={() => onChange(option.value)}>{option.value}</button>)}
    </nav>
  ),
}))
vi.mock('../locales', () => ({ locale: { text: (key: string) => key } }))
vi.mock('./skills-tab', () => ({
  SkillsTab: () => (
    <section>
      skills-content
      <input aria-label="skill draft" defaultValue="" />
    </section>
  ),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('extension panel composition', () => {
  it('renders the official plugins element as the only tab', () => {
    const markup = renderToStaticMarkup(<ExtensionPanel plugins={<section>official-plugins-content</section>} createSkill={async () => {}} />)
    expect(markup).toContain('data-active="plugins"')
    expect(markup).toContain('<button type="button">plugins</button>')
    expect(markup).not.toContain('<button type="button">mcp</button>')
    expect(markup).not.toContain('<button type="button">skills</button>')
    expect(markup).toContain('official-plugins-content')
    expect(markup).not.toContain('skills-content')
  })

  it('renders no tab content when the official plugins page is unavailable', () => {
    const markup = renderToStaticMarkup(<ExtensionPanel createSkill={async () => {}} />)
    expect(markup).not.toContain('official-plugins-content')
    expect(markup).not.toContain('skills-content')
  })

  it('keeps skills hidden while the plugins page is the active tab', () => {
    const view = render(<ExtensionPanel plugins={<section>official-plugins-content</section>} createSkill={async () => {}} />)
    expect(view.getByText('official-plugins-content')).not.toBeNull()
    expect(view.queryByRole('button', { name: 'skills' })).toBeNull()
    expect(view.queryByText('skills-content')).toBeNull()
  })

  it('remounts official plugins when the page disappears and returns', () => {
    const createSkill = async () => {}
    const plugins = <section>official-plugins-content</section>
    const view = render(<ExtensionPanel plugins={plugins} createSkill={createSkill} />)
    const first = view.getByText('official-plugins-content')
    view.rerender(<ExtensionPanel createSkill={createSkill} />)
    expect(view.queryByText('official-plugins-content')).toBeNull()
    view.rerender(<ExtensionPanel plugins={plugins} createSkill={createSkill} />)
    expect(view.getByText('official-plugins-content')).not.toBe(first)
    expect(view.getByText('official-plugins-content').closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
  })
})
