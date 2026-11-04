import { defineService } from 'dsh-tauri'

const DEFAULT_SKILL_BACKEND_BASE = 'http://127.0.0.1:8099'

interface ProxyResult {
  status: number
  payload: unknown
}

export const employeeSkills = defineService({
  common(authorization: string | undefined, pageNo?: string, pageSize?: string): Promise<ProxyResult> {
    return request('get', `/api/employee-skills/common${pagingOf(pageNo, pageSize)}`, authorization)
  },

  catalog(authorization: string | undefined, pageNo?: string, pageSize?: string): Promise<ProxyResult> {
    return request('get', `/api/employee-skills${pagingOf(pageNo, pageSize)}`, authorization)
  },

  user(authorization: string | undefined, userId: string): Promise<ProxyResult> {
    return request('get', `/api/employee-skills/user/${encodeURIComponent(userId)}`, authorization)
  },

  profile(authorization: string | undefined, userId: string): Promise<ProxyResult> {
    return request('get', `/api/employee-skills/user/${encodeURIComponent(userId)}/profile`, authorization)
  },

  save(authorization: string | undefined, userId: string, body: unknown): Promise<ProxyResult> {
    return request('post', `/api/employee-skills/user/${encodeURIComponent(userId)}`, authorization, body)
  },

  employees(authorization: string | undefined): Promise<ProxyResult> {
    return request('get', '/api/employee-skills/employees', authorization)
  },

  upload(authorization: string | undefined, file: ArrayBuffer, contentType: string, backendBase?: string): Promise<ProxyResult> {
    return requestRaw('post', '/api/employee-skills/upload', authorization, file, contentType, backendBase)
  },
})

function pagingOf(pageNo?: string, pageSize?: string): string {
  const query = new URLSearchParams()
  if (typeof pageNo === 'string' && pageNo.length > 0)
    query.set('pageNo', pageNo)
  if (typeof pageSize === 'string' && pageSize.length > 0)
    query.set('pageSize', pageSize)
  const text = query.toString()
  return text.length > 0 ? `?${text}` : ''
}

async function request(
  method: 'get' | 'post',
  path: string,
  authorization: string | undefined,
  body?: unknown,
): Promise<ProxyResult> {
  const response = await fetch(`${skillBackendBase()}${path}`, {
    method: method.toUpperCase(),
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, payload: await payloadOf(response) }
}

async function requestRaw(
  method: 'get' | 'post',
  path: string,
  authorization: string | undefined,
  body: BodyInit,
  contentType: string,
  backendBase?: string,
): Promise<ProxyResult> {
  const response = await fetch(`${skillBackendBase(backendBase)}${path}`, {
    method: method.toUpperCase(),
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
      ...(contentType.length === 0 ? {} : { 'content-type': contentType }),
    },
    body,
  })
  return { status: response.status, payload: await payloadOf(response) }
}

function skillBackendBase(overrideBase?: string): string {
  const preferred = normalizeBase(overrideBase)
  if (preferred !== null)
    return preferred
  const raw = process.env.DSH_SKILL_BACKEND_BASE_URL
  return normalizeBase(raw) ?? DEFAULT_SKILL_BACKEND_BASE
}

function normalizeBase(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0)
    return null
  try {
    const parsed = new URL(raw.trim())
    if (!['http:', 'https:'].includes(parsed.protocol))
      return null
    if (parsed.username.length > 0 || parsed.password.length > 0)
      return null
    return parsed.toString().replace(/\/+$/, '')
  }
  catch {
    return null
  }
}

async function payloadOf(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0)
    return {}
  try {
    return JSON.parse(text)
  }
  catch {
    return { error: text }
  }
}
