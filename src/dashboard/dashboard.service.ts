import { Injectable } from '@nestjs/common'
import { prisma } from '../lib/prisma'
import { AutopostService } from '../outstand/autopost.service'
import { NotesService } from '../notes/notes.service'

const SUPPORTED_PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X']
const UNSUPPORTED_PLATFORMS = ['TIKTOK', 'THREADS', 'BLUESKY', 'YOUTUBE', 'PINTEREST', 'GOOGLE_BIZ']
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

@Injectable()
export class DashboardService {
  constructor(
    private readonly autopostService: AutopostService,
    private readonly notesService: NotesService
  ) {}

  async getOverview(userId: string) {
    const now = new Date()
    const today = startOfDay(now)
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000)
    const weekEnd = new Date(today.getTime() + 7 * 24 * 3600 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000)

    const [
      user,
      connectionStatus,
      accountsOverview,
      trendMetrics,
      totalPostsGenerated,
      totalPostsScheduled,
      nextScheduledPost,
      upcomingCalendarPosts,
      postedLast30Days,
      postedLast7Days,
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
          logo: { select: { id: true } }
        }
      }),
      this.autopostService.getConnectionStatus(userId),
      this.autopostService.getAccountsOverviewAnalytics(userId),
      this.autopostService.calculateUserDashboardMetrics(userId, fourteenDaysAgo.toISOString(), now.toISOString()),
      prisma.calendarPost.count({ where: { userId } }),
      prisma.calendarPost.count({ where: { userId, status: 'SCHEDULED' } }),
      prisma.calendarPost.findFirst({
        where: { userId, status: 'SCHEDULED', postTime: { gte: now } },
        orderBy: { postTime: 'asc' },
        include: { content: true }
      }),
      prisma.calendarPost.findMany({
        where: { userId, status: { in: ['SCHEDULED', 'POSTING'] }, postTime: { gte: today, lt: weekEnd } },
        orderBy: { postTime: 'asc' },
        include: { content: true, image: true, reel: true }
      }),
      prisma.calendarPost.findMany({
        where: { userId, status: 'POSTED', updatedAt: { gte: thirtyDaysAgo } },
        select: { updatedAt: true }
      }),
      prisma.calendarPost.count({
        where: { userId, status: 'POSTED', updatedAt: { gte: sevenDaysAgo } }
      }),
      prisma.festival.findFirst({
        where: { date: { gte: today } },
        orderBy: { date: 'asc' },
        include: { images: { take: 1 } }
      }),
      this.notesService.get(userId)
    ])

    const connectedPlatforms = this.buildConnectedPlatforms(connectionStatus)
    const connectedCount = connectedPlatforms.filter(p => p.connected).length

    return {
      greeting: {
        name: user?.name || null,
        date: now.toISOString(),
        nextPostAt: nextScheduledPost?.postTime || null
      },
      insight: this.buildInsight(trendMetrics),
      autopilot: {
        active: connectedCount > 0,
        postsGenerated: totalPostsGenerated,
        postsScheduled: totalPostsScheduled,
        platformsConnected: { connected: connectedCount, total: SUPPORTED_PLATFORMS.length + UNSUPPORTED_PLATFORMS.length },
        nextScheduledPost: nextScheduledPost
          ? { time: nextScheduledPost.postTime, title: nextScheduledPost.content?.text || null }
          : null
      },
      upcomingFestival: upcomingFestival
        ? {
            name: upcomingFestival.event,
            date: upcomingFestival.date,
            imageUrl: upcomingFestival.images[0]?.file || null
          }
        : null,
      trendingHashtags: await this.getTrendingHashtags(user?.subIndustryId || null),
      quickNotes,
      recentActivity: await this.getRecentActivity(userId, today, sevenDaysAgo),
      upcomingPosts: this.bucketUpcomingPosts(upcomingCalendarPosts, today, tomorrow, weekEnd, connectedPlatforms),
      connectedPlatforms,
      analytics: {
        totalFollowers: accountsOverview.totals.totalFollowers,
        postsQueued: accountsOverview.totals.postsQueued,
        avgEngagementRate: accountsOverview.totals.avgEngagementRate
      },
      brandHealth: this.buildBrandHealth(user, postedLast30Days.length, postedLast7Days)
    }
  }

  private buildConnectedPlatforms(connectionStatus: { platforms: any[] }) {
    const supported = connectionStatus.platforms.map(p => ({
      platform: p.platform,
      connected: p.connected,
      supported: true,
      username: p.accounts[0]?.username || null,
      avatarUrl: p.accounts[0]?.avatarUrl || null
    }))
    const unsupported = UNSUPPORTED_PLATFORMS.map(platform => ({
      platform,
      connected: false,
      supported: false,
      username: null,
      avatarUrl: null
    }))
    return [...supported, ...unsupported]
  }

  private buildInsight(trendMetrics: any) {
    const series: Array<{ engagement: number }> = trendMetrics?.charts?.engagementOverTime || []
    if (series.length < 2) {
      return { message: 'Not enough data yet to show a weekly trend.', engagementGrowthPct: null }
    }

    const midpoint = Math.floor(series.length / 2)
    const olderWeek = series.slice(0, midpoint)
    const recentWeek = series.slice(midpoint)

    const sum = (arr: Array<{ engagement: number }>) => arr.reduce((acc, d) => acc + (d.engagement || 0), 0)
    const olderSum = sum(olderWeek)
    const recentSum = sum(recentWeek)

    const growthPct = olderSum > 0
      ? Math.round(((recentSum - olderSum) / olderSum) * 100)
      : (recentSum > 0 ? 100 : 0)

    const message = growthPct >= 0
      ? `Your engagement grew ${growthPct}% this week — keep it going!`
      : `Your engagement dipped ${Math.abs(growthPct)}% this week.`

    return { message, engagementGrowthPct: growthPct }
  }

  private async getTrendingHashtags(subIndustryId: string | null) {
    const contents = await prisma.content.findMany({
      where: subIndustryId ? { subIndustryId } : undefined,
      select: { hashtags: { select: { hashtag: { select: { tag: true } } } } },
      take: 200,
      orderBy: { createdAt: 'desc' }
    })

    const counts = new Map<string, number>()
    for (const content of contents) {
      for (const ch of content.hashtags) {
        counts.set(ch.hashtag.tag, (counts.get(ch.hashtag.tag) || 0) + 1)
      }
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([tag]) => tag)
  }

  private bucketUpcomingPosts(
    posts: Array<any>,
    today: Date,
    tomorrow: Date,
    weekEnd: Date,
    connectedPlatforms: Array<{ platform: string; connected: boolean }>
  ) {
    const dayAfterTomorrow = new Date(tomorrow.getTime() + 24 * 3600 * 1000)
    const platforms = connectedPlatforms.filter(p => p.connected).map(p => p.platform)

    const shape = (post: any) => ({
      time: post.postTime,
      title: post.content?.text || (post.type === 'REEL' ? 'Scheduled reel' : 'Scheduled post'),
      platforms
    })

    return {
      today: posts.filter(p => p.postTime >= today && p.postTime < tomorrow).map(shape),
      tomorrow: posts.filter(p => p.postTime >= tomorrow && p.postTime < dayAfterTomorrow).map(shape),
      thisWeek: posts.filter(p => p.postTime >= dayAfterTomorrow && p.postTime < weekEnd).map(shape)
    }
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
