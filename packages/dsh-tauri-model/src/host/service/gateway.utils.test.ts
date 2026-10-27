import type { GatewayGrant } from './gateway.types'
import { describe, expect, it } from 'vitest'
import {
  backendOf,
  carriesEmptyGrant,
  defaultGrantOf,
  fillFromPresets,
  grantsOf,
  keyRefOf,
  modelsUrlOf,
  presetKeyCandidates,
  profileOf,
  stableTextOf,
} from './gateway.utils'

const BACKEND = 'https://gw.example.com'

function first(payload: unknown): GatewayGrant | undefined {
  return grantsOf(payload, BACKEND)?.[0]
}

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
    expect(modelsUrlOf(BACKEND)).toBe('https://gw.example.com/api/model-provider/config')
  })
})

describe('grantsOf', () => {
  it('derives the gateway endpoint and defaults from a bare model list', () => {
    expect(first({ models: [{ id: 'deepseek-chat' }] })).toMatchObject({
      route: 'dsh-backend',
      baseURL: 'https://gw.example.com/api/v1',
      api: 'openai-completions',
      displayName: 'AI Gateway',
      defaultModel: 'deepseek-chat',
      declaresDefault: false,
      models: [{ id: 'deepseek-chat' }],
    })
  })

  it('keeps declared connection facts, trims the key and refuses credential headers', () => {
    const grant = first({
      route: 'Company-GW',
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
    })
    expect(grant).toMatchObject({
      route: 'company-gw',
      displayName: '公司网关',
      baseURL: 'https://gw.example.com/v1',
      api: 'anthropic-messages',
      apiKey: 'sk-key',
      defaultModel: 'a',
      headers: { 'x-tenant': 'tc' },
    })
    expect(grant?.models).toHaveLength(1)
  })

  it('falls back to the array position when a name cannot be slugged', () => {
    const grants = grantsOf([{ models: [{ id: 'a' }] }, { models: [{ id: 'b' }] }], BACKEND)
    expect(grants?.map(grant => grant.route)).toEqual(['dsh-backend', 'dsh-backend-2'])
  })

  it('slugifies a latin display name into the route key', () => {
    expect(first({ name: 'Vendor B', models: [{ id: 'm' }] })?.route).toBe('vendor-b')
  })

  it('accepts an OpenAI-style data array and falls back on an unknown protocol', () => {
    expect(first({ data: [{ id: 'm' }], api: 'grpc' })).toMatchObject({ api: 'openai-completions', models: [{ id: 'm' }] })
  })

  it('drops malformed entries without taking the whole batch down', () => {
    const grants = grantsOf([{ models: [{ name: 'no id' }] }, null, { models: [{ id: 'good' }] }], BACKEND)
    expect(grants?.map(grant => grant.models[0]?.id)).toEqual(['good'])
  })

  it('refuses a payload that carries no addressable model at all', () => {
    expect(grantsOf(null, BACKEND)).toBeUndefined()
    expect(grantsOf({ models: [] }, BACKEND)).toBeUndefined()
    expect(grantsOf({ models: 'deepseek-chat' }, BACKEND)).toBeUndefined()
  })

  it('accepts the code/data envelope around the gateway array', () => {
    const grants = grantsOf({
      code: 0,
      msg: null,
      data: [{
        route: 'company-gw',
        baseURL: 'https://gw.example.com/v1',
        api: 'openai-completions',
        name: '公司网关',
        apiKey: 'sk-key',
        models: [
          { id: 'qwen3.8-max', name: '通义千问 3.8 Max', contextWindow: 262_144, maxTokens: 16_384, input: ['text'], default: true },
          { id: 'qwen3.7-max', name: '通义千问 3.7 Max', contextWindow: 262_144, maxTokens: 16_384, input: ['text'] },
        ],
      }],
    }, BACKEND)
    expect(grants?.map(grant => grant.route)).toEqual(['company-gw'])
    expect(grants?.[0]?.models).toHaveLength(2)
    expect(grants?.[0]?.defaultModel).toBe('qwen3.8-max')
    expect(grants?.[0]?.baseURL).toBe('https://gw.example.com/v1')
  })

  it('still reads a bare data array of models as one gateway listing', () => {
    expect(first({ data: [{ id: 'm' }] })?.models).toEqual([{ id: 'm' }])
  })

  it('keys credentials per gateway so two upstreams never share one reference', () => {
    expect(keyRefOf('company-gw')).toBe('COMPANY_GW_API_KEY')
    expect(profileOf({
      route: 'company-gw',
      baseURL: 'https://gw/v1',
      api: 'openai-completions',
      displayName: 'n',
      models: [{ id: 'm' }],
      defaultModel: 'm',
      declaresDefault: false,
      apiKey: 'k',
    }).apiKeyEnv).toBe('COMPANY_GW_API_KEY')
  })
})

describe('grant default model', () => {
  it('prefers a top-level default over the model order', () => {
    expect(first({ defaultModel: 'second', models: [{ id: 'first' }, { id: 'second' }] })?.defaultModel).toBe('second')
  })

  it('takes the first model flagged default when no top-level name is given', () => {
    const grant = first({ models: [{ id: 'first' }, { id: 'second', default: true }] })
    expect(grant?.defaultModel).toBe('second')
    expect(grant?.declaresDefault).toBe(true)
  })

  it('ignores a declared default the endpoint does not actually grant', () => {
    expect(first({ defaultModel: 'not-granted', models: [{ id: 'first' }] })?.defaultModel).toBe('first')
  })

  it('lets the explicitly marked gateway win the default across several upstreams', () => {
    const grants = grantsOf([
      { route: 'a', models: [{ id: 'm-a' }] },
      { route: 'b', models: [{ id: 'm-b', default: true }] },
    ], BACKEND)
    expect(defaultGrantOf(grants ?? [])?.route).toBe('b')
  })

  it('falls back to the first gateway when nobody declares a default', () => {
    const grants = grantsOf([{ route: 'a', models: [{ id: 'm-a' }] }, { route: 'b', models: [{ id: 'm-b' }] }], BACKEND)
    expect(defaultGrantOf(grants ?? [])?.route).toBe('a')
    expect(defaultGrantOf([])).toBeUndefined()
  })

  it('drops the default marker from the projected model entry', () => {
    expect(first({ models: [{ id: 'first', default: true, name: '首个' }] })?.models[0]).toEqual({ id: 'first', name: '首个' })
  })
})

describe('carriesEmptyGrant', () => {
  it('tells an authoritative empty grant apart from a malformed payload', () => {
    expect(carriesEmptyGrant([])).toBe(true)
    expect(carriesEmptyGrant({ models: [] })).toBe(true)
    expect(carriesEmptyGrant({ data: [] })).toBe(true)
    expect(carriesEmptyGrant({ models: [{ name: 'no id' }] })).toBe(false)
    expect(carriesEmptyGrant([null])).toBe(false)
    expect(carriesEmptyGrant({ code: 0, data: [] })).toBe(true)
    expect(carriesEmptyGrant({ code: 0, data: [{ route: 'a', models: [] }] })).toBe(false)
    expect(carriesEmptyGrant(null)).toBe(false)
  })
})

describe('presetKeyCandidates', () => {
  it('matches the full id before its bare and prefix forms', () => {
    expect(presetKeyCandidates('Vendor/deepseek-v3-pro')).toEqual(['vendor/deepseek-v3-pro', 'deepseek-v3-pro', 'deepseek-v3', 'deepseek'])
  })
})

describe('fillFromPresets', () => {
  const grant: GatewayGrant = {
    route: 'company-gw',
    baseURL: 'https://gw.example.com/api/v1',
    api: 'openai-completions',
    displayName: 'AI Gateway',
    defaultModel: 'deepseek-v3',
    declaresDefault: false,
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
