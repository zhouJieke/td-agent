import { defineService } from 'dsh-tauri'

const SKILL_BACKEND_BASE = 'http://127.0.0.1:8099'

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
  const response = await fetch(`${SKILL_BACKEND_BASE}${path}`, {
    method: method.toUpperCase(),
    headers: {
      ...(authorization === undefined ? {} : { authorization }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return { status: response.status, payload: await payloadOf(response) }
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
