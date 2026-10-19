import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { defineTool } from './define-tool'
import { DEFAULT_LIMIT, clip, dateRange, describeRange, zFrom, zLimit, zTo } from './helpers'
import type { ToolDeps } from './index'

export function inboxTools({ auditLog }: ToolDeps) {
  return [
    defineTool(auditLog, {
      name: 'list_leads',
      description: 'Leads from the website lead forms, newest first. Search matches name, email, business or city.',
      schema: z.object({
        status: z.enum(['PENDING', 'DONE']).optional(),
        search: z.string().optional(),
        from: zFrom,
        to: zTo,
        limit: zLimit,
      }),
      run: async ({ status, search, from, to, limit }) => {
        const range = dateRange(from, to)
        const where: Record<string, any> = { createdAt: range }
        if (status) where.status = status
        if (search) {
          where.OR = ['name', 'email', 'businessName', 'city'].map((field) => ({
            [field]: { contains: search, mode: 'insensitive' },
          }))
        }
        const [total, leads] = await Promise.all([
          prisma.lead.count({ where }),
          prisma.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit ?? DEFAULT_LIMIT }),
        ])
        return {
          range: describeRange(range),
          totalMatching: total,
          leads: leads.map(({ updatedAt, ...lead }) => ({ ...lead, message: clip(lead.message) })),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'list_contact_messages',
      description: 'Messages from the "Contact us" form, newest first, with their reference number and status.',
      schema: z.object({
        status: z.enum(['new', 'in_progress', 'resolved']).optional(),
        inquiryType: z.enum(['sales', 'support', 'partner', 'press']).optional(),
        from: zFrom,
        to: zTo,
        limit: zLimit,
      }),
      run: async ({ status, inquiryType, from, to, limit }) => {
        const range = dateRange(from, to)
        const where: Record<string, any> = { createdAt: range }
        if (status) where.status = status
        if (inquiryType) where.inquiryType = inquiryType
        const [total, messages] = await Promise.all([
          prisma.contactMessage.count({ where }),
          prisma.contactMessage.findMany({
            where,
            select: {
              reference: true,
              inquiryType: true,
              name: true,
              email: true,
              phone: true,
              detail: true,
              message: true,
              status: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return {
          range: describeRange(range),
          totalMatching: total,
          messages: messages.map((m) => ({ ...m, message: clip(m.message) })),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'list_demo_bookings',
      description: 'Demo calls people booked, by slot time. Default range: the next 14 days.',
      schema: z.object({
        status: z.enum(['PENDING', 'CONFIRMED', 'CANCELLED']).optional(),
        from: z.string().optional().describe('Slot start date, YYYY-MM-DD (UTC). Default: today.'),
        to: z.string().optional().describe('Slot end date, YYYY-MM-DD (UTC). Default: 14 days from now.'),
        limit: zLimit,
      }),
      run: async ({ status, from, to, limit }) => {
        const today = new Date().toISOString().slice(0, 10)
        const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const range = dateRange(from ?? today, to ?? in14Days)
        const where: Record<string, any> = { slotTime: range }
        if (status) where.status = status
        const [total, bookings] = await Promise.all([
          prisma.demoBooking.count({ where }),
          prisma.demoBooking.findMany({
            where,
            select: { fullName: true, businessName: true, email: true, phone: true, slotTime: true, message: true, status: true },
            orderBy: { slotTime: 'asc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return {
          range: describeRange(range),
          totalMatching: total,
          bookings: bookings.map((b) => ({ ...b, message: clip(b.message) })),
        }
      },
    }),

    defineTool(auditLog, {
      name: 'list_industry_requests',
      description: 'Requests from people asking for an industry that Shoutly does not cover yet, newest first.',
      schema: z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), limit: zLimit }),
      run: async ({ status, limit }) => {
        const where = status ? { status } : {}
        const [total, requests] = await Promise.all([
          prisma.industryRequest.count({ where }),
          prisma.industryRequest.findMany({
            where,
            select: { industryName: true, email: true, status: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: limit ?? DEFAULT_LIMIT,
          }),
        ])
        return { totalMatching: total, requests }
      },
    }),

    defineTool(auditLog, {
      name: 'get_newsletter_stats',
      description: 'Newsletter subscriber counts (active and unsubscribed) and how many joined in a date range.',
      schema: z.object({ from: zFrom, to: zTo }),
      run: async ({ from, to }) => {
        const range = dateRange(from, to)
        const [active, unsubscribed, joined] = await Promise.all([
          prisma.newsletterSubscriber.count({ where: { isActive: true } }),
          prisma.newsletterSubscriber.count({ where: { isActive: false } }),
          prisma.newsletterSubscriber.count({ where: { createdAt: range } }),
        ])
        return { active, unsubscribed, joinedInRange: joined, range: describeRange(range) }
      },
    }),
  ]
}
