import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBlockedRefusal } from '../src/store/modules/plugins'

afterEach(() => vi.restoreAllMocks())

describe('blocked-refusal parsing', () => {
  it('reads a held upgrade as an authorizable target version', () => {
    const refusal = parseBlockedRefusal(`PLUGIN_UPDATE_NO_CHANGE: ${JSON.stringify({ name: 'dshmarket', version: '1.66.2', latest: '1.66.5', retryable: true })}`)

    expect(refusal).toEqual({
      kind: 'update-hold',
      versions: [{ name: 'dshmarket', version: '1.66.5' }],
      retryable: true,
      retryableNames: ['dshmarket'],
      heldNames: [],
    })
  })

  it('keeps a pinned-or-unknown hold without an authorizable version', () => {
    // 已经授权过（在豁免清单里）还是不动：版本号在 `versions` 里但不是可授权项，
    // 调用方据此报真实失败而不是让用户空点授权
    const punished = parseBlockedRefusal(`PLUGIN_UPDATE_NO_CHANGE: ${JSON.stringify({ name: 'dshmarket', version: '1.66.2', latest: '1.66.5', retryable: false })}`)
    expect(punished).toEqual({
      kind: 'update-hold',
      versions: [{ name: 'dshmarket', version: '1.66.5' }],
      retryable: false,
      retryableNames: [],
      heldNames: [],
    })

    // 连候选版本都没有：进 `heldNames`，调用方按「没有可安装的目标版本」报失败
    const unknown = parseBlockedRefusal(`PLUGIN_UPDATE_NO_CHANGE: ${JSON.stringify({ name: 'dshmarket', version: '1.66.2', latest: null, retryable: false })}`)
    expect(unknown).toEqual({
      kind: 'update-hold',
      versions: [],
      retryable: false,
      retryableNames: [],
      heldNames: ['dshmarket'],
    })
  })

  it('degrades a malformed hold payload to a plain failure', () => {
    expect(parseBlockedRefusal('PLUGIN_UPDATE_NO_CHANGE: not-json')).toBeNull()
    expect(parseBlockedRefusal(`PLUGIN_UPDATE_NO_CHANGE: ${JSON.stringify({ version: '1.66.2' })}`)).toBeNull()
  })
})
