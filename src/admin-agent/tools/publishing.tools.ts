import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { defineTool } from './define-tool'
import { DEFAULT_LIMIT, dateRange, describeRange, resolveUser, zFrom, zLimit, zTo, zUser } from './helpers'
import type { ToolDeps } from './index'

const zPostStatus = z.enum(['SCHEDULED', 'POSTING', 'SKIP', 'POSTED', 'FAILED']).optional()

const postSelect = {
  id: true,
  type: true,
  postTime: true,
  status: true,
  targetPlatforms: true,
  updatedAt: true,
  subIndustry: { select: { name: true } },
} as const

export function publishingTools({ auditLog }: ToolDeps) {
  return [
    defineTool(auditLog, {
      name: 'get_user_posts',
      description: "One user's calendar posts (auto-posting schedule) in a date range, by post time.",
      schema: z.object({ user: zUser, status: zPostStatus, from: zFrom, to: zTo, limit: zLimit }),
      run: async ({ user: userIdOrEmail, status, from, to, limit }) => {
        const user = await resolveUser(userIdOrEmail)
        const range = dateRange(from, to)
        const where: Record<string, any> = { userId: user.id, postTime: range }
        if (status) where.status = status

        const [total, posts] = await Promise.all([
          prisma.calendarPost.count({ where }),
          prisma.calendarPost.findMany({ where, select: postSelect, orderBy: { postTime: 'asc' }, take: limit ?? DEFAULT_LIMIT }),
        ])
        return { user, range: describeRange(range), totalMatching: total, posts }
      },
    }),

    defineTool(auditLog, {
      name: 'get_post_stats',
      description:
        'Counts of calendar posts by status (SCHEDULED, POSTING, POSTED, FAILED, SKIP) for a date range, across all users or for one user.',
      schema: z.object({ user: zUser.optional(), from: zFrom, to: zTo }),
      run: async ({ user: userIdOrEmail, from, to }) => {
        const range = dateRange(from, to)
        const user = userIdOrEmail ? await resolveUser(userIdOrEmail) : null
        const groups = await prisma.calendarPost.groupBy({
          by: ['status'],
          where: { postTime: range, ...(user ? { userId: user.id } : {}) },
          _count: { _all: true },
        })
        return {
          user: user ?? 'all users',
          range: describeRange(range),
          byStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'list_failed_posts',
      description:
        'Calendar posts that failed to publish in a date range, with the user each belongs to. For the queue error messages, use get_system_health.',
      schema: z.object({ from: zFrom, to: zTo, limit: zLimit }),
      run: async ({ from, to, limit }) => {
        const range = dateRange(from, to, 7)
        const where = { status: 'FAILED' as const, postTime: range }
        const [total, posts] = await Promise.all([
          prisma.calendarPost.count({ where }),
          prisma.calendarPost.findMany({
            where,
            select: { ...postSelect, user: { select: { name: true, email: true } } },
            orderBy: { postTime: 'desc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return { range: describeRange(range), totalFailed: total, posts }
      },
    }),
  ]
}
