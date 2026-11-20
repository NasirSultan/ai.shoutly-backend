import { ForbiddenException } from '@nestjs/common'
import { prisma } from '../lib/prisma'

export interface LeadFinderUser {
  id: string
  role?: string
}

// Lead Finder is for paid plans only: an active, non-trial, unexpired
// subscription (same rule as ApplyLogoService.isPaidSubscriber). SUPERADMIN
// always has access, like Website Analysis.
export async function hasLeadFinderAccess(user: LeadFinderUser): Promise<boolean> {
  if (user.role === 'SUPERADMIN') return true
  const sub = await prisma.subscription.findFirst({
    where: { userId: user.id, isActive: true, isTrial: false },
    select: { expiresAt: true },
  })
  return !!sub && (!sub.expiresAt || sub.expiresAt.getTime() > Date.now())
}

export async function assertLeadFinderAccess(user: LeadFinderUser): Promise<void> {
  if (!(await hasLeadFinderAccess(user))) {
    throw new ForbiddenException('Lead Finder is available on paid plans. Upgrade to find leads.')
  }
}
