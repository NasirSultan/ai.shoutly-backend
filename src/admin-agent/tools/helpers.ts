import { z } from 'zod'
import { prisma } from '../../lib/prisma'

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const zFrom = z.string().optional().describe('Start date, YYYY-MM-DD (UTC), inclusive. Default: 30 days ago.')
export const zTo = z.string().optional().describe('End date, YYYY-MM-DD (UTC), inclusive. Default: today.')
export const zLimit = z.number().int().min(1).max(50).optional().describe('Max rows to return. Default 10.')
export const zUser = z.string().describe("The user's email address or user id.")

export const DEFAULT_LIMIT = 10

export function dateRange(from?: string, to?: string, defaultDays = 30) {
  const parse = (value: string, field: string) => {
    if (!DATE_RE.test(value)) throw new Error(`${field} must be YYYY-MM-DD, got "${value}"`)
    return new Date(`${value}T00:00:00.000Z`)
  }
  const end = to ? new Date(parse(to, 'to').getTime() + DAY_MS - 1) : new Date()
  const start = from ? parse(from, 'from') : new Date(end.getTime() - defaultDays * DAY_MS)
  if (start > end) throw new Error('from must be before to')
  return { gte: start, lte: end }
}

export function describeRange(range: { gte: Date; lte: Date }) {
  return { from: range.gte.toISOString().slice(0, 10), to: range.lte.toISOString().slice(0, 10) }
}

export async function resolveUser(userIdOrEmail: string) {
  const value = userIdOrEmail.trim()
  const user = await prisma.user.findFirst({
    where: UUID_RE.test(value) ? { id: value } : { email: { equals: value, mode: 'insensitive' } },
    select: { id: true, name: true, email: true },
  })
  if (!user) throw new Error(`No user found for "${value}". Try search_users with part of their name or email.`)
  return user
}

export function clip(text: string | null | undefined, max = 300) {
  if (!text) return text ?? null
  return text.length > max ? `${text.slice(0, max)}...` : text
}
