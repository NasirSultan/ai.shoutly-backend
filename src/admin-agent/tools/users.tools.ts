import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { defineTool } from './define-tool'
import { DEFAULT_LIMIT, resolveUser, zLimit, zUser } from './helpers'
import type { ToolDeps } from './index'

export function usersTools({ auditLog }: ToolDeps) {
  return [
    defineTool(auditLog, {
      name: 'search_users',
      description:
        'Find users by part of their name, email or brand name, optionally filtered by role or status. Use this to get a user\'s email/id before other user tools.',
      schema: z.object({
        query: z.string().optional().describe('Part of the name, email or brand name.'),
        role: z.enum(['USER', 'SUPERADMIN', 'CONTENTADMIN', 'TECHNICIANADMIN', 'FINANCEADMIN']).optional(),
        status: z.enum(['active', 'suspended']).optional(),
        limit: zLimit,
      }),
      run: async ({ query, role, status, limit }) => {
        const where: Record<string, any> = {}
        if (query) {
          where.OR = ['name', 'email', 'brandName'].map((field) => ({
            [field]: { contains: query, mode: 'insensitive' },
          }))
        }
        if (role) where.role = role
        if (status) where.isActive = status === 'active'

        const [total, users] = await Promise.all([
          prisma.user.count({ where }),
          prisma.user.findMany({
            where,
            select: { id: true, name: true, email: true, role: true, isActive: true, brandName: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return { totalMatching: total, users }
      },
    }),

    defineTool(auditLog, {
      name: 'get_user_details',
      description:
        "Everything about one user: profile, industry, current plan, connected social accounts, and how many of their posts are scheduled/posted/failed.",
      schema: z.object({ user: zUser }),
      run: async ({ user: userIdOrEmail }) => {
        const { id } = await resolveUser(userIdOrEmail)
        const [user, activePlan, subscriptionCount, socialAccounts, postsByStatus] = await Promise.all([
          prisma.user.findUnique({
            where: { id },
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              role: true,
              isActive: true,
              brandName: true,
              website: true,
              watcherWebsite: true,
              jobTitle: true,
              timezone: true,
              language: true,
              twoFactorEnabled: true,
              connectedSocials: true,
              onboardingStartedAt: true,
              createdAt: true,
              industry: { select: { name: true } },
              subIndustry: { select: { name: true } },
            },
          }),
          prisma.subscription.findFirst({
            where: { userId: id, isActive: true },
            select: { plan: true, billing: true, amount: true, currency: true, isTrial: true, startedAt: true, expiresAt: true },
            orderBy: { createdAt: 'desc' },
          }),
          prisma.subscription.count({ where: { userId: id } }),
          prisma.socialAccount.findMany({
            where: { userId: id },
            select: { platform: true, username: true, status: true, createdAt: true },
          }),
          prisma.calendarPost.groupBy({ by: ['status'], where: { userId: id }, _count: { _all: true } }),
        ])

        return {
          user,
          currentPlan: activePlan ?? 'No active plan',
          subscriptionsEver: subscriptionCount,
          socialAccounts,
          calendarPostsByStatus: Object.fromEntries(postsByStatus.map((g) => [g.status, g._count._all])),
        }
      },
    }),
  ]
}
