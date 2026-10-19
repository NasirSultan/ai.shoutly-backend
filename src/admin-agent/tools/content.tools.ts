import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { defineTool } from './define-tool'
import type { ToolDeps } from './index'

export function contentTools({ auditLog }: ToolDeps) {
  return [
    defineTool(auditLog, {
      name: 'get_content_coverage',
      description:
        'Content library per sub-industry: how many images, captions (content) and reels each has, and how many users picked it. Sorted with the emptiest first, so it shows gaps.',
      schema: z.object({
        industry: z.string().optional().describe('Only sub-industries of this industry (part of its name).'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 20.'),
      }),
      run: async ({ industry, limit }) => {
        const subIndustries = await prisma.subIndustry.findMany({
          where: industry ? { industry: { name: { contains: industry, mode: 'insensitive' } } } : {},
          select: {
            name: true,
            industry: { select: { name: true } },
            _count: {
              select: { images: { where: { deletedAt: null } }, contents: true, reels: true, users: true },
            },
          },
        })
        const rows = subIndustries
          .map((s) => ({
            industry: s.industry.name,
            subIndustry: s.name,
            images: s._count.images,
            captions: s._count.contents,
            reels: s._count.reels,
            users: s._count.users,
          }))
          .sort((a, b) => a.images + a.captions + a.reels - (b.images + b.captions + b.reels))
        return { totalSubIndustries: rows.length, subIndustries: rows.slice(0, limit ?? 20) }
      },
    }),

    defineTool(auditLog, {
      name: 'list_industries',
      description: 'All industries with how many sub-industries and users each has.',
      schema: z.object({}),
      run: async () => {
        const industries = await prisma.industry.findMany({
          select: { name: true, _count: { select: { subIndustries: true, users: true } } },
          orderBy: { name: 'asc' },
        })
        return industries.map((i) => ({ industry: i.name, subIndustries: i._count.subIndustries, users: i._count.users }))
      },
    }),

    defineTool(auditLog, {
      name: 'get_template_credits',
      description: 'Template-download credit balance for an email, and the last changes to it (welcome credits, admin grants, downloads).',
      schema: z.object({ email: z.string().describe('The email the credits belong to.') }),
      run: async ({ email }) => {
        const normalized = email.trim().toLowerCase()
        const [credit, log] = await Promise.all([
          prisma.templateCredit.findUnique({
            where: { email: normalized },
            select: { email: true, balance: true, verifiedAt: true, createdAt: true },
          }),
          prisma.templateCreditLog.findMany({
            where: { email: normalized },
            select: { change: true, reason: true, renderId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 10,
          }),
        ])
        if (!credit) return `No template credits record for ${normalized}.`
        return { ...credit, recentChanges: log }
      },
    }),
  ]
}
