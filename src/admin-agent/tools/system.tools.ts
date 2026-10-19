import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { defineTool } from './define-tool'
import { dateRange, describeRange, resolveUser, zFrom, zTo } from './helpers'
import type { ToolDeps } from './index'

export function systemTools({ auditLog, adminMonitoring, adminDashboard }: ToolDeps) {
  return [
    defineTool(auditLog, {
      name: 'get_platform_overview',
      description:
        'Headline numbers for the whole platform: users (total, new in 30 days), subscriptions, AI cost in 30 days, content library size, connected social accounts.',
      schema: z.object({}),
      run: async () => {
        const o = await adminDashboard.getOverview()
        return {
          users: { total: o.users.total, newLast30Days: o.users.newLast30Days },
          subscriptions: o.subscriptions,
          aiUsageLast30Days: {
            calls: o.aiUsage.totalCallsLast30Days,
            costUsd: o.aiUsage.totalCostUsdLast30Days,
            byProvider: o.aiUsage.byProvider,
          },
          contentLibrary: o.contentLibrary,
          socialAccounts: o.socialAccounts,
        }
      },
    }),

    defineTool(auditLog, {
      name: 'get_system_health',
      description:
        "Live system status: database/Redis health, the publishing queue (with recent failed jobs and their errors), today's publishing counts, posts stuck in POSTING, cron jobs that stopped, outside-service errors, and recent alerts.",
      schema: z.object({}),
      run: async () => {
        const s = await adminMonitoring.snapshot()
        return {
          ...s,
          queue: { counts: s.queue.counts, failedJobs: s.queue.failedJobs.slice(0, 10) },
          stuckPosts: s.stuckPosts.slice(0, 20),
          alerts: s.alerts.slice(0, 10),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'get_ai_usage',
      description:
        'AI calls and estimated cost (USD) in a date range, grouped by provider, model, operation, or user (top spenders). Optionally for one user.',
      schema: z.object({
        groupBy: z.enum(['provider', 'model', 'operation', 'user']).optional().describe('Default: provider.'),
        user: z.string().optional().describe("Only this user's usage (email or id)."),
        from: zFrom,
        to: zTo,
      }),
      run: async ({ groupBy = 'provider', user: userIdOrEmail, from, to }) => {
        const range = dateRange(from, to)
        const user = userIdOrEmail ? await resolveUser(userIdOrEmail) : null
        const where = { createdAt: range, ...(user ? { userId: user.id } : {}) }
        const field = groupBy === 'user' ? 'userId' : groupBy

        const [totals, groups] = await Promise.all([
          prisma.aiUsageLog.aggregate({ where, _sum: { estimatedCostUsd: true, totalTokens: true }, _count: { _all: true } }),
          prisma.aiUsageLog.groupBy({
            by: [field],
            where,
            _sum: { estimatedCostUsd: true },
            _count: { _all: true },
            orderBy: { _sum: { estimatedCostUsd: 'desc' } },
            take: 15,
          }),
        ])

        const userIds = groupBy === 'user' ? groups.map((g) => g.userId).filter((id): id is string => !!id) : []
        const users = userIds.length
          ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } })
          : []
        const emailById = new Map(users.map((u) => [u.id, u.email]))

        return {
          range: describeRange(range),
          user: user ?? 'all users',
          totals: {
            calls: totals._count._all,
            costUsd: totals._sum.estimatedCostUsd ?? 0,
            tokens: totals._sum.totalTokens ?? 0,
          },
          groups: groups.map((g) => ({
            [groupBy]:
              groupBy === 'user'
                ? g.userId
                  ? (emailById.get(g.userId) ?? g.userId)
                  : 'no user (system / public calls)'
                : g[field],
            calls: g._count._all,
            costUsd: g._sum.estimatedCostUsd ?? 0,
          })),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'search_audit_logs',
      description:
        'Who did what in the admin panel: role changes, suspensions, deletions, credit grants, monitoring actions. Newest first.',
      schema: z.object({
        action: z.string().optional().describe('Exact action, e.g. USER_ROLE_CHANGED, USER_STATUS_CHANGED, USER_DELETED.'),
        actorEmail: z.string().optional().describe('Part of the email of the admin who did it.'),
        targetId: z.string().optional().describe('Id of the thing that was changed, e.g. a user id.'),
        includeAgentCalls: z.boolean().optional().describe('Include this assistant\'s own tool calls. Default false.'),
        from: zFrom,
        to: zTo,
        limit: z.number().int().min(1).max(50).optional(),
      }),
      run: async ({ action, actorEmail, targetId, includeAgentCalls, from, to, limit }) => {
        const range = dateRange(from, to)
        const where: Record<string, any> = { createdAt: range }
        if (action) where.action = action
        else if (!includeAgentCalls) where.action = { not: 'ADMIN_AGENT_TOOL_CALLED' }
        if (actorEmail) where.actorEmail = { contains: actorEmail, mode: 'insensitive' }
        if (targetId) where.targetId = targetId

        const [total, logs] = await Promise.all([
          prisma.auditLog.count({ where }),
          prisma.auditLog.findMany({
            where,
            select: { actorEmail: true, action: true, targetType: true, targetId: true, before: true, after: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: limit ?? 15,
          }),
        ])
        return { range: describeRange(range), totalMatching: total, logs }
      },
    }),
  ]
}
