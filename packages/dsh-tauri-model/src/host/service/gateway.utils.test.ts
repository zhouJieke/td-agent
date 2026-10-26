import type { GatewayGrant } from './gateway.types'
import { describe, expect, it } from 'vitest'
import {
  backendOf,
  fillFromPresets,
  grantOf,
  modelsUrlOf,
  profileOf,
  stableTextOf,
} from './gateway.utils'

const BACKEND = 'https://gw.example.com'

describe('backendOf', () => {
  it('adds the https scheme and drops trailing slashes', () => {
    expect(backendOf({ DSH_MODEL_BACKEND_URL: 'gw.example.com/' } as NodeJS.ProcessEnv))
      .toBe('https://gw.example.com')
    expect(backendOf({ DSH_MODEL_BACKEND_URL: ' http://127.0.0.1:8080/api/ ' } as NodeJS.ProcessEnv))
      .toBe('http://127.0.0.1:8080/api')
  })

  it('reads an unset, blank or unparsable backend as disabled', () => {
    expect(backendOf({} as NodeJS.ProcessEnv)).toBeUndefined()
    expect(backendOf({ DSH_MODEL_BACKEND_URL: '   ' } as NodeJS.ProcessEnv)).toBeUndefined()
    expect(backendOf({ DSH_MODEL_BACKEND_URL: 'gw example' } as NodeJS.ProcessEnv)).toBeUndefined()
  })
})

describe('modelsUrlOf', () => {
  it('keeps every backend interface under the api prefix', () => {
    expect(modelsUrlOf(BACKEND)).toBe('https://gw.example.com/api/ai/models')
  })
})

describe('grantOf', () => {
  it('derives the gateway endpoint and defaults from a bare model list', () => {
    expect(grantOf({ models: [{ id: 'deepseek-chat' }] }, BACKEND)).toMatchObject({
      baseURL: 'https://gw.example.com/api/v1',
      api: 'openai-completions',
      displayName: 'AI Gateway',
      models: [{ id: 'deepseek-chat' }],
    })
  })

  it('keeps declared connection facts, trims the key and refuses credential headers', () => {
    const grant = grantOf({
      name: '公司网关',
      baseURL: 'https://gw.example.com/v1',
      api: 'anthropic-messages',
      apiKey: ' sk-key ',
      headers: { 'x-tenant': 'tc', 'Authorization': 'Bearer HIJACK' },
      models: [
        { id: 'a', contextWindow: 128_000, maxTokens: 8192, input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
        { id: 'a' },
        { name: 'missing id' },
      ],
    }, BACKEND)
    expect(grant).toMatchObject({
      displayName: '公司网关',
      baseURL: 'https://gw.example.com/v1',
      api: 'anthropic-messages',
      apiKey: 'sk-key',
      headers: { 'x-tenant': 'tc' },
    })
    expect(grant?.models).toHaveLength(1)
    expect(grant?.models[0]).toMatchObject({ id: 'a', input: ['text', 'image'], reasoningEfforts: { high: 'high' } })
  })

  it('accepts an OpenAI-style data array and falls back on an unknown protocol', () => {
    expect(grantOf({ data: [{ id: 'm' }], api: 'grpc' }, BACKEND))
      .toMatchObject({ api: 'openai-completions', models: [{ id: 'm' }] })
  })

  it('refuses payloads without an addressable model', () => {
    expect(grantOf(null, BACKEND)).toBeUndefined()
    expect(grantOf({ models: [] }, BACKEND)).toBeUndefined()
    expect(grantOf({ models: [{ name: 'no id' }] }, BACKEND)).toBeUndefined()
    expect(grantOf({ models: 'deepseek-chat' }, BACKEND)).toBeUndefined()
  })
})

describe('profileOf', () => {
  it('names the credential reference only when the grant carries a key', () => {
    const keyed = profileOf(
      { baseURL: 'https://gw/v1', api: 'openai-completions', displayName: 'n', models: [{ id: 'm' }], apiKey: 'k' },
      'DSH_BACKEND_API_KEY',
    )
    expect(keyed.apiKeyEnv).toBe('DSH_BACKEND_API_KEY')
    const bare = profileOf({ baseURL: 'https://gw/v1', api: 'openai-completions', displayName: 'n', models: [{ id: 'm' }] }, 'DSH_BACKEND_API_KEY')
    expect('apiKeyEnv' in bare).toBe(false)
  })
})

describe('fillFromPresets', () => {
  const grant: GatewayGrant = {
    baseURL: 'https://gw.example.com/api/v1',
    api: 'openai-completions',
    displayName: 'AI Gateway',
    models: [{ id: 'DeepSeek-V3' }, { id: 'kimi-k2', contextWindow: 4096 }],
  }

  it('fills undisclosed capacities from the catalog row and keeps declared facts', () => {
    const filled = fillFromPresets(grant, {
      'deepseek-v3': [1, 0, 64_000, 8192],
      'kimi-k2': [0, 0, 128_000, 2048],
    })
    expect(filled.models[0]).toEqual({ id: 'DeepSeek-V3', contextWindow: 64_000, maxTokens: 8192, input: ['text', 'image'] })
    expect(filled.models[1]).toEqual({ id: 'kimi-k2', contextWindow: 4096, maxTokens: 2048 })
  })

  it('returns the grant untouched when the catalog is unavailable', () => {
    expect(fillFromPresets(grant, undefined)).toBe(grant)
  })
})

describe('stableTextOf', () => {
  it('ignores key order so an unchanged profile is never rewritten', () => {
    expect(stableTextOf({ a: 1, b: { y: 2, x: 3 } })).toBe(stableTextOf({ b: { x: 3, y: 2 }, a: 1 }))
    expect(stableTextOf({ models: [{ id: 'a', contextWindow: 1 }] })).not.toBe(stableTextOf({ models: [{ id: 'a', contextWindow: 2 }] }))
  })
})
