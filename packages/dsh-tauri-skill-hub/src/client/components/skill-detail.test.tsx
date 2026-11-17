// @vitest-environment jsdom
import type { SkillRowView, SkillSummary } from '../types'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { invoke } from 'dsh-tauri/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSkill, getSkills } from '../apis'
import { locale } from '../locales'
import { store } from '../store'
import { SkillCatalog } from './skill-catalog'
import { SkillDetailModal } from './skill-detail-modal'

vi.mock('dsh-tauri/client', async importOriginal => ({
  ...await importOriginal<typeof import('dsh-tauri/client')>(),
  invoke: vi.fn(),
}))

vi.mock('../apis', async importOriginal => ({
  ...await importOriginal<typeof import('../apis')>(),
  getSkill: vi.fn(),
  getSkills: vi.fn(),
}))

function summary(name: string): SkillSummary {
  return {
    namespaceId: 'company',
    name,
    description: `${name} description`,
    updateTime: 1_700_000_000_000,
    owner: 'E9',
    enable: true,
    bizTags: null,
    from: 'platform',
    scope: 'enterprise',
    labels: { latest: '1.2.0' },
    editingVersion: '1.3.0',
    reviewingVersion: null,
    onlineCnt: 4,
    downloadCount: 12,
  }
}

function localRow(name: string): SkillRowView {
  return {
    name,
    description: `${name} local description`,
    whenToUse: 'Use for review',
    invocation: { modelInvocable: true, userInvocable: false },
    source: 'user-dsh',
    provider: 'skill-hub-filesystem',
    editable: true,
    removable: true,
    policyEditable: true,
  }
}

function catalog(skills: SkillSummary[]) {
  return render(
    <>
      <SkillCatalog t={locale.text} hint="" emptyText="" skills={skills} />
      <SkillDetailModal t={locale.text} />
    </>,
  )
}

beforeEach(() => {
  store.skill.setTab('enterprise')
  store.skill.setEmployee({ employeeNumber: 'E1', employeeName: 'Employee' })
  store.skill.setKeyword('')
  store.skill.setDetail(null)
  store.skill.dismissFeedback()
  store.skill.finishInstalledLoad(store.skill.startInstalledLoad(), [])
  vi.mocked(invoke).mockReset()
  vi.mocked(getSkill).mockReset()
  vi.mocked(getSkills).mockReset()
  vi.mocked(getSkills).mockResolvedValue({ skills: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('企业技能只读详情', () => {
  it('卡片只展示技能名称与简介', () => {
    const view = catalog([summary('alpha')])

    expect(view.getByText('alpha').textContent).toBe('alpha')
    expect(view.getByText('alpha description').textContent).toBe('alpha description')
    expect(view.queryByText('1.2.0')).toBeNull()
    expect(view.queryByText('platform')).toBeNull()
    expect(view.queryByText('12')).toBeNull()
  })

  it('点击卡片打开只读详情并补齐本地正文', async () => {
    vi.mocked(getSkill).mockResolvedValue({ name: 'alpha', content: '# Alpha guide' })
    vi.mocked(getSkills).mockResolvedValue({ skills: [localRow('alpha')] })
    const view = catalog([summary('alpha')])

    fireEvent.click(view.getByText('alpha'))

    const dialog = await view.findByRole('dialog', { name: 'View skill' })
    expect((await within(dialog).findByText('Alpha guide')).tagName).toBe('H1')
    expect((within(dialog).getByLabelText('Description') as HTMLInputElement).disabled).toBe(true)
    expect((within(dialog).getByLabelText('When to use (optional)') as HTMLInputElement).value).toBe('Use for review')
    expect((within(dialog).getByRole('checkbox', { name: 'User-invocable (/)' }) as HTMLInputElement).checked).toBe(false)
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('本地未安装时只展示名称与简介', async () => {
    vi.mocked(getSkill).mockResolvedValue({ error: 'SKILL_NOT_FOUND: alpha' })
    const view = catalog([summary('alpha')])

    fireEvent.click(view.getByText('alpha'))

    const dialog = await view.findByRole('dialog', { name: 'View skill' })
    expect(await within(dialog).findByText('This skill is not installed locally; showing name and description only.')).not.toBeNull()
    expect(within(dialog).queryByText('Body (Markdown)')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('关闭按钮收起详情', async () => {
    vi.mocked(getSkill).mockResolvedValue({ name: 'alpha', content: '# Alpha guide' })
    const view = catalog([summary('alpha')])
    fireEvent.click(view.getByText('alpha'))
    const dialog = await view.findByRole('dialog', { name: 'View skill' })

    const closes = within(dialog).getAllByRole('button', { name: 'Close' })
    fireEvent.click(closes[closes.length - 1])

    expect(store.skill.detail).toBeNull()
    await waitFor(() => expect(view.queryByLabelText('Description')).toBeNull())
  })
})
