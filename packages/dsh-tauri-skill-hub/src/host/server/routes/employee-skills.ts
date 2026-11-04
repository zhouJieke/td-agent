import type { H3Event } from 'h3'
import { defineEventHandler, getQuery, getRouterParam, readBody } from 'h3'
import { employeeSkills } from '../../service/employee-skills'

function authOf(event: H3Event): string | undefined {
  const header = event.req.headers.get('authorization')
  return typeof header === 'string' && header.trim().length > 0 ? header : undefined
}

function userIdOf(event: H3Event): string {
  return getRouterParam(event, 'userId') ?? ''
}

export const commonSkillsGet = defineEventHandler(async (event) => {
  const query = getQuery<{ pageNo?: string, pageSize?: string }>(event)
  const { status, payload } = await employeeSkills.common(authOf(event), query.pageNo, query.pageSize)
  event.res.status = status
  return payload
})

export const skillsCatalogGet = defineEventHandler(async (event) => {
  const query = getQuery<{ pageNo?: string, pageSize?: string }>(event)
  const { status, payload } = await employeeSkills.catalog(authOf(event), query.pageNo, query.pageSize)
  event.res.status = status
  return payload
})

export const userSkillsGet = defineEventHandler(async (event) => {
  const { status, payload } = await employeeSkills.user(authOf(event), userIdOf(event))
  event.res.status = status
  return payload
})

export const profileGet = defineEventHandler(async (event) => {
  const { status, payload } = await employeeSkills.profile(authOf(event), userIdOf(event))
  event.res.status = status
  return payload
})

export const userSkillsPost = defineEventHandler(async (event) => {
  const body = await readBody<unknown>(event)
  const { status, payload } = await employeeSkills.save(authOf(event), userIdOf(event), body)
  event.res.status = status
  return payload
})

export const employeesGet = defineEventHandler(async (event) => {
  const { status, payload } = await employeeSkills.employees(authOf(event))
  event.res.status = status
  return payload
})

export const skillUploadPost = defineEventHandler(async (event) => {
  const contentType = event.req.headers.get('content-type') ?? ''
  const backendBase = event.req.headers.get('x-skill-backend-base') ?? undefined
  const file = await event.req.arrayBuffer()
  const { status, payload } = await employeeSkills.upload(authOf(event), file, contentType, backendBase)
  event.res.status = status
  return payload
})
