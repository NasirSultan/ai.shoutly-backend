import { BadRequestException, Injectable } from '@nestjs/common'
import { prisma } from '../lib/prisma'
import { NotesService } from '../notes/notes.service'

// Every platform the app supports, in display order.
const SUPPORTED_PLATFORMS = [
  'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'YOUTUBE',
  'TIKTOK', 'PINTEREST', 'THREADS', 'BLUESKY', 'GOOGLE_BUSINESS'
]

// These connect directly and live in their own tables. Old Outstand
// SocialAccount rows for them stay behind after a disconnect, so they are
// never used to decide if these platforms are connected.
const DIRECT_PLATFORMS = ['FACEBOOK', 'LINKEDIN', 'X', 'YOUTUBE', 'GOOGLE_BUSINESS']

type PlatformConnection = {
  platform: string
  connected: boolean
  expired: boolean
  needsAction: 'RECONNECT' | 'SELECT_LOCATION' | null
  accountCount: number
  username: string | null
  avatarUrl: string | null
  followers: number | null
}

const POSTING_FREQUENCY_TARGET_PER_WEEK = 5
const PROFILE_CHECKLIST_SIZE = 8

function startOfDay(d: Date) {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function dayKey(d: Date) {
  return d.toISOString().split('T')[0]
}

const DAY_MS = 24 * 3600 * 1000

export type StatsPeriod = 'week' | 'month'

// UTC range for a week (Monday–Sunday) or a calendar month. offset 0 is the
// current one, 1 the one before, and so on. `end` is exclusive.
function periodRange(period: StatsPeriod, offset: number, now = new Date()) {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (period === 'week') {
    const daysSinceMonday = (new Date(todayUtc).getUTCDay() + 6) % 7
    const start = new Date(todayUtc - (daysSinceMonday + offset * 7) * DAY_MS)
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1))
  return { start, end }
}

@Injectable()
export class DashboardService {
  constructor(private readonly notesService: NotesService) {}

  async getOverview(userId: string) {
    const now = new Date()
    const today = startOfDay(now)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

    const [
      user,
      activeSubscription,
      connectedPlatforms,
      nextScheduledPost,
      postedLast30Days,
      postedLast7Days,
      postedPrevious7Days,
      failedLast30Days,
      manualPostsQueued,
      upcomingFestival,
      quickNotes
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          brandName: true,
          brandLogo: true,
          website: true,
          jobTitle: true,
          phone: true,
          industryId: true,
          subIndustryId: true,
          logo: { select: { id: true } },
          industry: { select: { id: true, name: true } },
          subIndustry: { select: { id: true, name: true } }
        }
      }),
      prisma.subscription.findFirst({
        where: { userId, isActive: true, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' }
      }),
      this.getPlatformConnections(userId),
      prisma.calendarPost.findFirst({
        where: { userId, status: 'SCHEDULED', postTime: { gte: now } },
        orderBy: { postTime: 'asc' },
        include: { content: true }
      }),
      prisma.calendarPost.findMany({
        where: { userId, status: 'POSTED', updatedAt: { gte: thirtyDaysAgo } },
        select: { updatedAt: true }
      }),
      prisma.calendarPost.count({
        where: { userId, status: 'POSTED', updatedAt: { gte: sevenDaysAgo } }
      }),
      prisma.calendarPost.count({
        where: { userId, status: 'POSTED', updatedAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } }
      }),
      prisma.calendarPost.count({
        where: { userId, status: 'FAILED', updatedAt: { gte: thirtyDaysAgo } }
      }),
      prisma.post.count({ where: { userId, status: 'SCHEDULED' } }),
      prisma.festival.findFirst({
        where: { date: { gte: today }, images: { some: { deletedAt: null } } },
        orderBy: { date: 'asc' },
        include: { images: { where: { deletedAt: null }, take: 1 } }
      }),
      this.notesService.get(userId)
    ])

    const needsAttention = connectedPlatforms
      .filter(p => p.needsAction)
      .map(p => ({ platform: p.platform, action: p.needsAction }))

    return {
      greeting: {
        name: user?.name || null,
        date: now.toISOString(),
        nextPostAt: nextScheduledPost?.postTime || null
      },
      subIndustrySelected: {
        selected: !!user?.subIndustryId,
        id: user?.subIndustryId || null,
        name: user?.subIndustry?.name || null,
        industry: user?.industry ? { id: user.industry.id, name: user.industry.name } : null
      },
      subscription: {
        // STARTER | BUSINESS | AUTOPILOT | GROWTH (legacy) | FREE (no active plan)
        plan: activeSubscription?.plan || 'FREE',
        billing: activeSubscription?.billing || null,
        isTrial: !!activeSubscription?.isTrial,
        isPurchased: !!activeSubscription && !activeSubscription.isTrial,
        expiresAt: activeSubscription?.expiresAt || null
      },
      insight: this.buildInsight(postedLast7Days, postedPrevious7Days),
      upcomingFestival: upcomingFestival
        ? {
            name: upcomingFestival.event,
            date: upcomingFestival.date,
            imageUrl: upcomingFestival.images[0]?.file || null
          }
        : null,
      quickNotes,
      recentActivity: await this.getRecentActivity(userId, today, sevenDaysAgo),
      connectedPlatforms,
      needsAttention,
      analytics: this.buildAnalytics(connectedPlatforms, postedLast30Days.length, failedLast30Days, postedLast7Days, manualPostsQueued),
      // Count distinct days with at least one post, not the number of posts.
      brandHealth: this.buildBrandHealth(
        user,
        new Set(postedLast30Days.map(p => dayKey(p.updatedAt))).size,
        postedLast7Days
      )
    }
  }

  // GET /dashboard/autopilot — summary plus the current week and month.
  async getAutopilot(userId: string) {
    const now = new Date()
    const [connectedPlatforms, statusCounts, generatedTotal, nextScheduledPost, thisWeek, thisMonth] = await Promise.all([
      this.getPlatformConnections(userId),
      prisma.calendarPost.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      prisma.calendarPost.count({ where: { userId } }),
      prisma.calendarPost.findFirst({
        where: { userId, status: 'SCHEDULED', postTime: { gte: now } },
        orderBy: { postTime: 'asc' },
        include: { content: true }
      }),
      this.getPeriodStats(userId, 'week', 0),
      this.getPeriodStats(userId, 'month', 0)
    ])

    const byStatus = (status: string) => statusCounts.find(s => s.status === status)?._count._all || 0
    const connected = connectedPlatforms.filter(p => p.connected).length
    const working = connectedPlatforms.filter(p => p.connected && !p.expired).length
    const needsAttention = connectedPlatforms.filter(p => p.needsAction).length

    return {
      active: working > 0,
      totals: {
        generated: generatedTotal,
        published: byStatus('POSTED'),
        failed: byStatus('FAILED'),
        scheduled: byStatus('SCHEDULED')
      },
      thisWeek,
      thisMonth,
      platformsConnected: { connected, working, needsAttention, total: SUPPORTED_PLATFORMS.length },
      nextScheduledPost: nextScheduledPost
        ? { time: nextScheduledPost.postTime, title: nextScheduledPost.content?.text || null }
        : null
    }
  }

  // GET /dashboard/autopilot/history?period=week|month&offset=N
  async getAutopilotHistory(userId: string, period: string, offset: string) {
    if (period !== 'week' && period !== 'month') {
      throw new BadRequestException('period must be "week" or "month"')
    }
    const n = offset === undefined || offset === '' ? 1 : Number(offset)
    if (!Number.isInteger(n) || n < 0 || n > 120) {
      throw new BadRequestException('offset must be a whole number from 0 to 120')
    }
    return this.getPeriodStats(userId, period, n)
  }

  // Generated = by created date. Published / failed = by post time.
  // Every day in the range is returned, with zeros where nothing happened.
  private async getPeriodStats(userId: string, period: StatsPeriod, offset: number) {
    const { start, end } = periodRange(period, offset)

    const [generatedRows, outcomeRows] = await Promise.all([
      prisma.calendarPost.findMany({
        where: { userId, createdAt: { gte: start, lt: end } },
        select: { createdAt: true }
      }),
      prisma.calendarPost.findMany({
        where: { userId, status: { in: ['POSTED', 'FAILED'] }, postTime: { gte: start, lt: end } },
        select: { postTime: true, status: true }
      })
    ])

    const days = new Map<string, { date: string; generated: number; published: number; failed: number }>()
    for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
      const key = dayKey(new Date(t))
      days.set(key, { date: key, generated: 0, published: 0, failed: 0 })
    }
    for (const row of generatedRows) {
      const day = days.get(dayKey(row.createdAt))
      if (day) day.generated += 1
    }
    for (const row of outcomeRows) {
      const day = days.get(dayKey(row.postTime))
      if (!day) continue
      if (row.status === 'POSTED') day.published += 1
      else day.failed += 1
    }

    const list = [...days.values()]
    return {
      period,
      offset,
      start: dayKey(start),
      end: dayKey(new Date(end.getTime() - DAY_MS)),
      generated: generatedRows.length,
      published: list.reduce((sum, d) => sum + d.published, 0),
      failed: list.reduce((sum, d) => sum + d.failed, 0),
      days: list
    }
  }

  // One row per supported platform. Direct platforms (Facebook, LinkedIn, X,
  // YouTube, Google Business) are read from their own tables — the same
  // tables their /status endpoints use. Only Outstand platforms come from
  // SocialAccount.
  private async getPlatformConnections(userId: string): Promise<PlatformConnection[]> {
    const now = Date.now()
    const isExpired = (expiry: Date | null | undefined) => !!expiry && expiry.getTime() <= now

    const [socialAccounts, facebookPages, linkedIn, xAccount, youtube, google] = await Promise.all([
      prisma.$queryRaw<Array<{ platform: string; username: string | null; avatarUrl: string | null; status: string }>>`
        SELECT platform::text AS platform, username, "avatarUrl", status
        FROM "SocialAccount"
        WHERE "userId" = ${userId}
      `,
      prisma.facebookPage.findMany({
        where: { facebookAccount: { userId } },
        orderBy: { createdAt: 'asc' }
      }),
      prisma.linkedAccount.findFirst({
        where: { userId, platform: 'LINKEDIN' },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.xAccount.findUnique({ where: { userId } }),
      prisma.youtubeAccount.findUnique({ where: { userId } }),
      prisma.googleBusinessAccount.findUnique({
        where: { userId },
        include: { locations: { where: { selected: true, canPost: true } } }
      })
    ])

    const empty = (platform: string): PlatformConnection => ({
      platform, connected: false, expired: false, needsAction: null,
      accountCount: 0, username: null, avatarUrl: null, followers: null
    })
    const toNumber = (v: string | null | undefined) => (v ? Number(v) || 0 : null)

    const direct: Record<string, PlatformConnection> = {}

    if (facebookPages.length) {
      direct.FACEBOOK = {
        ...empty('FACEBOOK'),
        connected: true,
        accountCount: facebookPages.length,
        username: (facebookPages.find(p => p.isDefault) || facebookPages[0]).pageName || null
      }
    }

    if (linkedIn) {
      const expired = isExpired(linkedIn.tokenExpiry)
      direct.LINKEDIN = { ...empty('LINKEDIN'), connected: true, expired, needsAction: expired ? 'RECONNECT' : null, accountCount: 1 }
    }

    if (xAccount) {
      // X refreshes its token on its own while a refresh token exists.
      const expired = isExpired(xAccount.tokenExpiry) && !xAccount.refreshToken
      direct.X = {
        ...empty('X'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        username: xAccount.username || xAccount.name || null,
        avatarUrl: xAccount.profileImageUrl || null,
        followers: toNumber(xAccount.followersCount)
      }
    }

    if (youtube) {
      const expired = isExpired(youtube.tokenExpiry) && !youtube.refreshToken
      direct.YOUTUBE = {
        ...empty('YOUTUBE'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        username: youtube.channelTitle || null,
        avatarUrl: youtube.thumbnailUrl || null,
        followers: toNumber(youtube.subscriberCount)
      }
    }

    if (google) {
      // Same rule as GoogleBusinessService.status(): only a chosen,
      // postable location counts as connected.
      const expired = isExpired(google.tokenExpiry) && !google.refreshToken
      const hasLocation = google.locations.length > 0
      direct.GOOGLE_BUSINESS = {
        ...empty('GOOGLE_BUSINESS'),
        connected: hasLocation,
        expired,
        needsAction: expired ? 'RECONNECT' : hasLocation ? null : 'SELECT_LOCATION',
        accountCount: google.locations.length,
        username: google.locations[0]?.title || null
      }
    }

    return SUPPORTED_PLATFORMS.map(platform => {
      if (DIRECT_PLATFORMS.includes(platform)) return direct[platform] || empty(platform)

      const rows = socialAccounts.filter(a => a.platform === platform)
      if (!rows.length) return empty(platform)
      const active = rows.filter(a => a.status === 'active')
      const first = active[0] || rows[0]
      return {
        ...empty(platform),
        connected: active.length > 0,
        expired: active.length === 0,
        needsAction: active.length ? null : 'RECONNECT',
        accountCount: active.length,
        username: first.username || null,
        avatarUrl: first.avatarUrl || null
      }
    })
  }

  // All from our own DB — no Outstand calls.
  private buildAnalytics(
    connectedPlatforms: PlatformConnection[],
    publishedLast30Days: number,
    failedLast30Days: number,
    publishedLast7Days: number,
    postsQueued: number
  ) {
    const attempted = publishedLast30Days + failedLast30Days
    return {
      // X followers + YouTube subscribers, as saved by their own services.
      totalFollowers: connectedPlatforms
        .filter(p => p.connected)
        .reduce((sum, p) => sum + (p.followers || 0), 0),
      postsQueued,
      publishedLast7Days,
      publishedLast30Days,
      failedLast30Days,
      successRate: attempted > 0 ? Math.round((publishedLast30Days / attempted) * 100) : null
    }
  }

  // Posts published this week vs the week before.
  private buildInsight(thisWeek: number, lastWeek: number) {
    if (thisWeek === 0 && lastWeek === 0) {
      return { message: 'No posts published in the last 2 weeks yet.', postsGrowthPct: null, thisWeek, lastWeek }
    }
    const growthPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 100
    const message = growthPct >= 0
      ? `You published ${thisWeek} post${thisWeek === 1 ? '' : 's'} this week — up ${growthPct}% from last week!`
      : `You published ${thisWeek} post${thisWeek === 1 ? '' : 's'} this week — down ${Math.abs(growthPct)}% from last week.`
    return { message, postsGrowthPct: growthPct, thisWeek, lastWeek }
  }

  private async getRecentActivity(userId: string, today: Date, sevenDaysAgo: Date) {
    let windowStart = today
    let entries = await this.buildActivityEntries(userId, windowStart)

    if (entries.length === 0) {
      windowStart = sevenDaysAgo
      entries = await this.buildActivityEntries(userId, windowStart)
    }

    return entries.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 15)
  }

  private async buildActivityEntries(userId: string, windowStart: Date) {
    const [generated, scheduled, posted, failed, reelsQueued] = await Promise.all([
      prisma.calendarPost.findMany({
        where: { userId, createdAt: { gte: windowStart } },
        select: { createdAt: true }
      }),
      prisma.calendarPost.findMany({
        where: { userId, status: 'SCHEDULED', updatedAt: { gte: windowStart } },
        select: { updatedAt: true }
      }),
      prisma.postDelivery.findMany({
        where: {
          deliveryStatus: 'PUBLISHED',
          updatedAt: { gte: windowStart },
          post: { userId }
        },
        select: { updatedAt: true, socialAccount: { select: { platform: true } } }
      }),
      prisma.calendarPost.findMany({
        where: { userId, status: 'FAILED', updatedAt: { gte: windowStart } },
        select: { updatedAt: true }
      }),
      prisma.calendarPost.findMany({
        where: { userId, type: 'REEL', status: { in: ['SCHEDULED', 'POSTING'] }, createdAt: { gte: windowStart } },
        select: { createdAt: true }
      })
    ])

    const entries: Array<{ type: string; message: string; time: Date }> = []

    this.groupByDay(generated, r => r.createdAt).forEach(({ count, latest }) => {
      entries.push({ type: 'posts_generated', message: `${count} post${count > 1 ? 's' : ''} generated`, time: latest })
    })

    this.groupByDay(scheduled, r => r.updatedAt).forEach(({ count, latest }) => {
      entries.push({ type: 'posts_scheduled', message: `${count} post${count > 1 ? 's' : ''} scheduled for optimal times`, time: latest })
    })

    const postedByPlatform = new Map<string, Array<{ updatedAt: Date }>>()
    for (const p of posted) {
      const platform = p.socialAccount?.platform || 'UNKNOWN'
      if (!postedByPlatform.has(platform)) postedByPlatform.set(platform, [])
      postedByPlatform.get(platform)!.push({ updatedAt: p.updatedAt })
    }
    for (const [platform, rows] of postedByPlatform) {
      this.groupByDay(rows, r => r.updatedAt).forEach(({ count, latest }) => {
        entries.push({ type: 'post_published', message: `${count} post${count > 1 ? 's' : ''} published — ${platform} completed`, time: latest })
      })
    }

    this.groupByDay(failed, r => r.updatedAt).forEach(({ count, latest }) => {
      entries.push({ type: 'post_failed', message: `${count} post${count > 1 ? 's' : ''} failed to publish`, time: latest })
    })

    this.groupByDay(reelsQueued, r => r.createdAt).forEach(({ count, latest }) => {
      entries.push({ type: 'reel_queued', message: `${count} reel${count > 1 ? 's' : ''} queued`, time: latest })
    })

    return entries
  }

  private groupByDay<T>(rows: T[], getDate: (row: T) => Date) {
    const groups = new Map<string, { count: number; latest: Date }>()
    for (const row of rows) {
      const date = getDate(row)
      const key = dayKey(date)
      const existing = groups.get(key)
      if (!existing) {
        groups.set(key, { count: 1, latest: date })
      } else {
        existing.count += 1
        if (date > existing.latest) existing.latest = date
      }
    }
    return [...groups.values()]
  }

  private buildBrandHealth(user: any, postedDaysCount: number, postedLast7Days: number) {
    const contentConsistency = Math.min(100, Math.round((postedDaysCount / 30) * 100))
    const postingFrequency = Math.min(100, Math.round((postedLast7Days / POSTING_FREQUENCY_TARGET_PER_WEEK) * 100))

    const checklist = [
      !!user?.brandName,
      !!user?.brandLogo,
      !!user?.logo,
      !!user?.website,
      !!user?.jobTitle,
      !!user?.industryId,
      !!user?.subIndustryId,
      !!user?.phone
    ]
    const profileCompletion = Math.round((checklist.filter(Boolean).length / PROFILE_CHECKLIST_SIZE) * 100)

    const score = Math.round((contentConsistency + postingFrequency + profileCompletion) / 3)

    const breakdown = { contentConsistency, postingFrequency, profileCompletion }
    const lowest = Object.entries(breakdown).sort((a, b) => a[1] - b[1])[0][0]

    let suggestion = ''
    if (lowest === 'profileCompletion') {
      suggestion = 'Complete your brand profile — fill in the missing brand details to boost your score.'
    } else if (lowest === 'postingFrequency') {
      const gap = Math.max(0, POSTING_FREQUENCY_TARGET_PER_WEEK - postedLast7Days)
      suggestion = gap > 0
        ? `Schedule ${gap} more post${gap > 1 ? 's' : ''} this week to lift posting frequency above ${postingFrequency}.`
        : 'Keep up your current posting frequency.'
    } else {
      suggestion = `You've posted on ${postedDaysCount} of the last 30 days — post more consistently to improve this score.`
    }

    return { score, breakdown, suggestion }
  }
}
