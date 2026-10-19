import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { defineTool } from './define-tool'
import { DEFAULT_LIMIT, dateRange, describeRange, resolveUser, zFrom, zLimit, zTo, zUser } from './helpers'
import type { ToolDeps } from './index'

const zPlan = z.enum(['STARTER', 'GROWTH', 'BUSINESS', 'AUTOPILOT']).optional()

export function paymentsTools({ auditLog }: ToolDeps) {
  return [
    defineTool(auditLog, {
      name: 'list_subscriptions',
      description:
        'List subscriptions (plans users are on), newest first. Filter by status, plan, or the date they started.',
      schema: z.object({
        status: z.enum(['active', 'expired', 'trial']).optional(),
        plan: zPlan,
        from: zFrom,
        to: zTo,
        limit: zLimit,
      }),
      run: async ({ status, plan, from, to, limit }) => {
        const range = dateRange(from, to, 365)
        const where: Record<string, any> = { startedAt: range }
        if (status === 'active') where.isActive = true
        if (status === 'expired') where.isActive = false
        if (status === 'trial') where.isTrial = true
        if (plan) where.plan = plan

        const [total, rows] = await Promise.all([
          prisma.subscription.count({ where }),
          prisma.subscription.findMany({
            where,
            select: {
              plan: true,
              billing: true,
              amount: true,
              currency: true,
              isActive: true,
              isTrial: true,
              startedAt: true,
              expiresAt: true,
              user: { select: { name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return { range: describeRange(range), totalMatching: total, subscriptions: rows }
      },
    }),

    defineTool(auditLog, {
      name: 'list_payments',
      description:
        'List Razorpay plan payments (orders), newest first. Use status FAILED to see failed payments and why they failed.',
      schema: z.object({
        status: z.enum(['CREATED', 'PAID', 'FAILED']).optional().describe('CREATED means checkout was opened but not paid.'),
        plan: zPlan,
        from: zFrom,
        to: zTo,
        limit: zLimit,
      }),
      run: async ({ status, plan, from, to, limit }) => {
        const range = dateRange(from, to)
        const where: Record<string, any> = { createdAt: range }
        if (status) where.status = status
        if (plan) where.plan = plan

        const [total, rows] = await Promise.all([
          prisma.payment.count({ where }),
          prisma.payment.findMany({
            where,
            select: {
              plan: true,
              billing: true,
              amount: true,
              currency: true,
              status: true,
              failureReason: true,
              razorpayOrderId: true,
              paidAt: true,
              createdAt: true,
              user: { select: { name: true, email: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return { range: describeRange(range), totalMatching: total, payments: rows }
      },
    }),

    defineTool(auditLog, {
      name: 'get_revenue_summary',
      description:
        'Money received from plan payments in a date range: total and split by plan and currency, plus failed and unpaid order counts. Also template-download revenue.',
      schema: z.object({ from: zFrom, to: zTo }),
      run: async ({ from, to }) => {
        const range = dateRange(from, to)
        const [byPlan, byStatus, templates] = await Promise.all([
          prisma.payment.groupBy({
            by: ['plan', 'currency'],
            where: { status: 'PAID', paidAt: range },
            _sum: { amount: true },
            _count: { _all: true },
          }),
          prisma.payment.groupBy({ by: ['status'], where: { createdAt: range }, _count: { _all: true } }),
          prisma.templatePurchase.groupBy({
            by: ['currency'],
            where: { status: 'PAID', paidWith: 'RAZORPAY', paidAt: range },
            _sum: { amount: true },
            _count: { _all: true },
          }),
        ])
        return {
          range: describeRange(range),
          planRevenue: byPlan.map((g) => ({
            plan: g.plan,
            currency: g.currency,
            payments: g._count._all,
            amount: g._sum.amount ?? 0,
          })),
          ordersByStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
          templateRevenue: templates.map((g) => ({
            currency: g.currency,
            downloads: g._count._all,
            amount: g._sum.amount ?? 0,
          })),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'get_user_payments',
      description: "One user's full billing history: every subscription and every payment attempt.",
      schema: z.object({ user: zUser }),
      run: async ({ user: userIdOrEmail }) => {
        const user = await resolveUser(userIdOrEmail)
        const [subscriptions, payments] = await Promise.all([
          prisma.subscription.findMany({
            where: { userId: user.id },
            select: {
              plan: true,
              billing: true,
              amount: true,
              currency: true,
              isActive: true,
              isTrial: true,
              startedAt: true,
              expiresAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
          prisma.payment.findMany({
            where: { userId: user.id },
            select: {
              plan: true,
              billing: true,
              amount: true,
              currency: true,
              status: true,
              failureReason: true,
              razorpayOrderId: true,
              paidAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
          }),
        ])
        return { user, subscriptions, payments }
      },
    }),
  ]
}
