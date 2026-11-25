// @vitest-environment jsdom
import type { SkillSummary } from '../types'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { locale } from '../locales'
import { SkillCard } from './skill-card'

function summary(name: string, bizTags: string | null): SkillSummary {
  return {
    namespaceId: 'company',
    name,
    description: `${name} description`,
    updateTime: null,
    owner: null,
    enable: true,
    bizTags,
    from: null,
    scope: null,
    labels: {},
    editingVersion: null,
    reviewingVersion: null,
    onlineCnt: null,
    downloadCount: null,
  }
}

afterEach(cleanup)

describe('技能卡片业务标签', () => {
  it('解析并展示 bizTags 中的每个标签', () => {
    const view = render(<SkillCard t={locale.text} skill={summary('alpha', '["企业公用","研发"]')} />)

    expect(view.getByText('企业公用')).not.toBeNull()
    expect(view.getByText('研发')).not.toBeNull()
    expect(view.container.querySelectorAll('[data-tone="neutral"]')).toHaveLength(2)
  })

  it('bizTags 为 null 或非法时不渲染标签', () => {
    const empty = render(<SkillCard t={locale.text} skill={summary('beta', null)} />)
    expect(empty.container.querySelectorAll('[data-tone]')).toHaveLength(0)
    cleanup()

    const invalid = render(<SkillCard t={locale.text} skill={summary('gamma', 'not json')} />)
    expect(invalid.container.querySelectorAll('[data-tone]')).toHaveLength(0)
  })
})
