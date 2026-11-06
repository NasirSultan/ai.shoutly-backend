import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

// Every platform the app supports, in display order.
const SUPPORTED_PLATFORMS = [
  'FACEBOOK', 'INSTAGRAM', 'LINKEDIN', 'X', 'YOUTUBE',
  'TIKTOK', 'PINTEREST', 'THREADS', 'BLUESKY', 'GOOGLE_BUSINESS'
]

// These connect directly and live in their own tables. Old Outstand
// SocialAccount rows for them stay behind after a disconnect, so they are
// never used to decide if these platforms are connected.
const DIRECT_PLATFORMS = ['FACEBOOK', 'LINKEDIN', 'X', 'YOUTUBE', 'GOOGLE_BUSINESS', 'TIKTOK', 'BLUESKY']

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
const DAY_MS = 24 * 3600 * 1000

export type StatsPeriod = 'week' | 'month'

function dayKey(d: Date) {
  return d.toISOString().split('T')[0]
}

function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// UTC range for a week (Monday–Sunday) or a calendar month. offset 0 is the
// current one, 1 the one before, and so on. `end` is exclusive.
function periodRange(period: StatsPeriod, offset: number, now = new Date()) {
  const today = utcMidnight(now).getTime()
  if (period === 'week') {
    const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7
    const start = new Date(today - (daysSinceMonday + offset * 7) * DAY_MS)
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) }
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1))
  return { start, end }
}

// Timestamp columns are stored in UTC without a zone. Turn them into ISO
// strings ending in Z so JSON output matches what Prisma Date objects gave.
const iso = (column: string) => Prisma.raw(`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
// A JS Date as a UTC timestamp parameter.
const ts = (d: Date) => Prisma.sql`${d.toISOString()}::timestamp`

// Each dashboard API runs ONE SQL query. Every query to the database costs a
// full network round trip (≈1s from far away) and the pool only allows a few
// at once, so ~25 small queries made the dashboard take 15–25 seconds.
@Injectable()
export class DashboardService {
  async getOverview(userId: string) {
    const now = new Date()
    const today = utcMidnight(now)
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS)

    const [{ data }] = await prisma.$queryRaw<Array<{ data: any }>>`
      SELECT json_build_object(
        'user', (
          SELECT json_build_object(
            'name', u.name,
            'brandName', u."brandName",
            'brandLogo', u."brandLogo",
            'website', u.website,
            'jobTitle', u."jobTitle",
            'phone', u.phone,
            'industryId', u."industryId",
            'subIndustryId', u."subIndustryId",
            'hasLogo', EXISTS (SELECT 1 FROM "Logo" l WHERE l."userId" = u.id),
            'industryName', i.name,
            'subIndustryName', s.name
          )
          FROM "User" u
          LEFT JOIN "Industry" i ON i.id = u."industryId"
          LEFT JOIN "SubIndustry" s ON s.id = u."subIndustryId"
          WHERE u.id = ${userId}
        ),
        'subscription', (
          SELECT json_build_object(
            'plan', plan::text,
            'billing', billing::text,
            'isTrial', "isTrial",
            'expiresAt', ${iso('"expiresAt"')}
          )
          FROM "Subscription"
          WHERE "userId" = ${userId} AND "isActive" AND "expiresAt" > ${ts(now)}
          ORDER BY "createdAt" DESC
          LIMIT 1
        ),
        'connections', ${this.connectionsSql(userId)},
        'nextPost', (
          SELECT json_build_object('time', ${iso('cp."postTime"')}, 'title', c.text)
          FROM "CalendarPost" cp
          LEFT JOIN "Content" c ON c.id = cp."contentId"
          WHERE cp."userId" = ${userId} AND cp.status = 'SCHEDULED' AND cp."postTime" >= ${ts(now)}
          ORDER BY cp."postTime" ASC
          LIMIT 1
        ),
        'counts', (
          SELECT json_build_object(
            'posted7', count(*) FILTER (WHERE status = 'POSTED' AND "updatedAt" >= ${ts(sevenDaysAgo)}),
            'postedPrev7', count(*) FILTER (WHERE status = 'POSTED' AND "updatedAt" >= ${ts(fourteenDaysAgo)} AND "updatedAt" < ${ts(sevenDaysAgo)}),
            'posted30', count(*) FILTER (WHERE status = 'POSTED'),
            'failed30', count(*) FILTER (WHERE status = 'FAILED'),
            'postedDays30', count(DISTINCT date("updatedAt")) FILTER (WHERE status = 'POSTED')
          )
          FROM "CalendarPost"
          WHERE "userId" = ${userId} AND "updatedAt" >= ${ts(thirtyDaysAgo)}
        ),
        'manualQueued', (SELECT count(*) FROM "Post" WHERE "userId" = ${userId} AND status = 'SCHEDULED'),
        'festival', (
          SELECT json_build_object(
            'name', f.event,
            'date', ${iso('f.date')},
            'imageUrl', (
              SELECT fi.file FROM "FestivalImage" fi
              WHERE fi."festivalId" = f.id AND fi."deletedAt" IS NULL
              LIMIT 1
            )
          )
          FROM "Festival" f
          WHERE f.date >= ${ts(today)}
            AND EXISTS (SELECT 1 FROM "FestivalImage" fi WHERE fi."festivalId" = f.id AND fi."deletedAt" IS NULL)
          ORDER BY f.date ASC
          LIMIT 1
        ),
        'note', (
          SELECT json_build_object('text', text, 'updatedAt', ${iso('"updatedAt"')})
          FROM "Note" WHERE "userId" = ${userId}
        ),
        'activity', (
          SELECT coalesce(json_agg(a), '[]'::json) FROM (
            SELECT 'posts_generated' AS type, NULL AS platform, date("createdAt")::text AS day,
                   count(*) AS count, ${iso('max("createdAt")')} AS latest
            FROM "CalendarPost"
            WHERE "userId" = ${userId} AND "createdAt" >= ${ts(sevenDaysAgo)}
            GROUP BY date("createdAt")
            UNION ALL
            SELECT 'posts_scheduled', NULL, date("updatedAt")::text, count(*), ${iso('max("updatedAt")')}
            FROM "CalendarPost"
            WHERE "userId" = ${userId} AND status = 'SCHEDULED' AND "updatedAt" >= ${ts(sevenDaysAgo)}
            GROUP BY date("updatedAt")
            UNION ALL
            SELECT 'post_failed', NULL, date("updatedAt")::text, count(*), ${iso('max("updatedAt")')}
            FROM "CalendarPost"
            WHERE "userId" = ${userId} AND status = 'FAILED' AND "updatedAt" >= ${ts(sevenDaysAgo)}
            GROUP BY date("updatedAt")
            UNION ALL
            SELECT 'reel_queued', NULL, date("createdAt")::text, count(*), ${iso('max("createdAt")')}
            FROM "CalendarPost"
            WHERE "userId" = ${userId} AND type = 'REEL' AND status IN ('SCHEDULED', 'POSTING')
              AND "createdAt" >= ${ts(sevenDaysAgo)}
            GROUP BY date("createdAt")
            UNION ALL
            SELECT 'post_published', coalesce(sa.platform::text, 'UNKNOWN'), date(pd."updatedAt")::text,
                   count(*), ${iso('max(pd."updatedAt")')}
            FROM "PostDelivery" pd
            JOIN "Post" p ON p.id = pd."postId"
            LEFT JOIN "SocialAccount" sa ON sa.id = pd."socialAccountId"
            WHERE p."userId" = ${userId} AND pd."deliveryStatus" = 'PUBLISHED' AND pd."updatedAt" >= ${ts(sevenDaysAgo)}
            GROUP BY coalesce(sa.platform::text, 'UNKNOWN'), date(pd."updatedAt")
          ) a
        )
      ) AS data
    `

    const user = data.user
    const sub = data.subscription
    const counts = data.counts
    // Not returned; only used for analytics.totalFollowers.
    const connectedPlatforms = this.buildConnections(data.connections, now)

    return {
      greeting: {
        name: user?.name || null,
        date: now.toISOString(),
        nextPostAt: data.nextPost?.time || null
      },
      subIndustrySelected: {
        selected: !!user?.subIndustryId,
        id: user?.subIndustryId || null,
        name: user?.subIndustryName || null,
        industry: user?.industryId ? { id: user.industryId, name: user.industryName } : null
      },
      subscription: {
        // STARTER | BUSINESS | AUTOPILOT | GROWTH (legacy) | FREE (no active plan)
        plan: sub?.plan || 'FREE',
        billing: sub?.billing || null,
        isTrial: !!sub?.isTrial,
        isPurchased: !!sub && !sub.isTrial,
        expiresAt: sub?.expiresAt || null
      },
      insight: this.buildInsight(counts.posted7, counts.postedPrev7),
      upcomingFestival: data.festival || null,
      quickNotes: { text: data.note?.text || '', updatedAt: data.note?.updatedAt || null },
      recentActivity: this.buildRecentActivity(data.activity, dayKey(today)),
      analytics: this.buildAnalytics(connectedPlatforms, counts.posted30, counts.failed30, counts.posted7, Number(data.manualQueued)),
      // Count distinct days with at least one post, not the number of posts.
      brandHealth: this.buildBrandHealth(user, counts.postedDays30, counts.posted7)
    }
  }

  // GET /dashboard/autopilot — summary plus the current week and month.
  async getAutopilot(userId: string) {
    const now = new Date()
    const week = periodRange('week', 0, now)
    const month = periodRange('month', 0, now)
    // One date range that covers both, sliced per period afterwards.
    const start = new Date(Math.min(week.start.getTime(), month.start.getTime()))
    const end = new Date(Math.max(week.end.getTime(), month.end.getTime()))

    const [{ data }] = await prisma.$queryRaw<Array<{ data: any }>>`
      SELECT json_build_object(
        'connections', ${this.connectionsSql(userId)},
        'totals', (
          SELECT json_build_object(
            'generated', count(*),
            'published', count(*) FILTER (WHERE status = 'POSTED'),
            'failed', count(*) FILTER (WHERE status = 'FAILED'),
            'scheduled', count(*) FILTER (WHERE status = 'SCHEDULED')
          )
          FROM "CalendarPost" WHERE "userId" = ${userId}
        ),
        'nextPost', (
          SELECT json_build_object('time', ${iso('cp."postTime"')}, 'title', c.text)
          FROM "CalendarPost" cp
          LEFT JOIN "Content" c ON c.id = cp."contentId"
          WHERE cp."userId" = ${userId} AND cp.status = 'SCHEDULED' AND cp."postTime" >= ${ts(now)}
          ORDER BY cp."postTime" ASC
          LIMIT 1
        ),
        ${this.dailySeriesSql(userId, start, end)}
      ) AS data
    `

    const connectedPlatforms = this.buildConnections(data.connections, now)
    const connected = connectedPlatforms.filter(p => p.connected).length
    const working = connectedPlatforms.filter(p => p.connected && !p.expired).length
    const needsAttention = connectedPlatforms.filter(p => p.needsAction).length

    return {
      active: working > 0,
      totals: data.totals,
      thisWeek: this.buildPeriod('week', 0, week.start, week.end, data),
      thisMonth: this.buildPeriod('month', 0, month.start, month.end, data),
      platformsConnected: { connected, working, needsAttention, total: SUPPORTED_PLATFORMS.length },
      nextScheduledPost: data.nextPost || null
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
    const { start, end } = periodRange(period, n)
    const [{ data }] = await prisma.$queryRaw<Array<{ data: any }>>`
      SELECT json_build_object(${this.dailySeriesSql(userId, start, end)}) AS data
    `
    return this.buildPeriod(period, n, start, end, data)
  }

  // Generated = by created date. Published / failed = by post time.
  private dailySeriesSql(userId: string, start: Date, end: Date) {
    return Prisma.sql`
      'generatedByDay', (
        SELECT coalesce(json_agg(g), '[]'::json) FROM (
          SELECT date("createdAt")::text AS day, count(*) AS n
          FROM "CalendarPost"
          WHERE "userId" = ${userId} AND "createdAt" >= ${ts(start)} AND "createdAt" < ${ts(end)}
          GROUP BY 1
        ) g
      ),
      'outcomesByDay', (
        SELECT coalesce(json_agg(o), '[]'::json) FROM (
          SELECT date("postTime")::text AS day,
                 count(*) FILTER (WHERE status = 'POSTED') AS published,
                 count(*) FILTER (WHERE status = 'FAILED') AS failed
          FROM "CalendarPost"
          WHERE "userId" = ${userId} AND status IN ('POSTED', 'FAILED')
            AND "postTime" >= ${ts(start)} AND "postTime" < ${ts(end)}
          GROUP BY 1
        ) o
      )
    `
  }

  // Every day in the range is returned, with zeros where nothing happened.
  private buildPeriod(period: StatsPeriod, offset: number, start: Date, end: Date, data: any) {
    const days = new Map<string, { date: string; generated: number; published: number; failed: number }>()
    for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) {
      const key = dayKey(new Date(t))
      days.set(key, { date: key, generated: 0, published: 0, failed: 0 })
    }
    for (const row of data.generatedByDay) {
      const day = days.get(row.day)
      if (day) day.generated = Number(row.n)
    }
    for (const row of data.outcomesByDay) {
      const day = days.get(row.day)
      if (!day) continue
      day.published = Number(row.published)
      day.failed = Number(row.failed)
    }

    const list = [...days.values()]
    const sum = (k: 'generated' | 'published' | 'failed') => list.reduce((s, d) => s + d[k], 0)
    return {
      period,
      offset,
      start: dayKey(start),
      end: dayKey(new Date(end.getTime() - DAY_MS)),
      generated: sum('generated'),
      published: sum('published'),
      failed: sum('failed'),
      days: list
    }
  }

  // GET /accounts/status — every platform with its accounts, in one query.
  // Same connection rules as the dashboard, plus per-platform details:
  // Facebook Pages, Google locations, Pinterest boards.
  async getAccountsStatus(userId: string) {
    const now = new Date()
    const [{ data }] = await prisma.$queryRaw<Array<{ data: any }>>`
      SELECT ${this.connectionsSql(userId)} AS data
    `
    const platforms = this.buildConnections(data, now, true)
    return {
      summary: {
        connected: platforms.filter(p => p.connected).length,
        working: platforms.filter(p => p.connected && !p.expired).length,
        needsAttention: platforms.filter(p => p.needsAction).length,
        total: platforms.length
      },
      platforms
    }
  }

  // Connection rows for every platform. Direct platforms (Facebook, LinkedIn,
  // X, YouTube, Google Business) come from their own tables — the same tables
  // their /status endpoints use. Only Outstand platforms use SocialAccount.
  private connectionsSql(userId: string) {
    return Prisma.sql`json_build_object(
      'social', (
        SELECT coalesce(json_agg(json_build_object(
          'id', id, 'platform', platform::text, 'username', username, 'avatarUrl', "avatarUrl", 'status', status,
          'defaultBoardId', "defaultBoardId", 'defaultBoardName', "defaultBoardName",
          'lastSync', ${iso('"updatedAt"')}
        ) ORDER BY "createdAt"), '[]'::json)
        FROM "SocialAccount" WHERE "userId" = ${userId}
      ),
      'facebookPages', (
        SELECT coalesce(json_agg(json_build_object(
          'id', fp.id, 'pageName', fp."pageName", 'pageId', fp."pageId", 'isDefault', fp."isDefault",
          'lastSync', ${iso('fp."updatedAt"')}
        ) ORDER BY fp."createdAt"), '[]'::json)
        FROM "FacebookPage" fp
        JOIN "FacebookAccount" fa ON fa.id = fp."facebookAccountId"
        WHERE fa."userId" = ${userId}
      ),
      'linkedIn', (
        SELECT json_build_object('id', id, 'tokenExpiry', ${iso('"tokenExpiry"')}, 'lastSync', ${iso('"updatedAt"')})
        FROM "LinkedAccount" WHERE "userId" = ${userId} AND platform = 'LINKEDIN'
        ORDER BY "createdAt" DESC LIMIT 1
      ),
      'x', (
        SELECT json_build_object(
          'id', id,
          'tokenExpiry', ${iso('"tokenExpiry"')},
          'hasRefreshToken', coalesce("refreshToken", '') <> '',
          'username', username, 'name', name,
          'avatarUrl', "profileImageUrl", 'followers', "followersCount",
          'lastSync', ${iso('"updatedAt"')}
        )
        FROM "XAccount" WHERE "userId" = ${userId}
      ),
      'youtube', (
        SELECT json_build_object(
          'id', id,
          'tokenExpiry', ${iso('"tokenExpiry"')},
          'hasRefreshToken', coalesce("refreshToken", '') <> '',
          'username', "channelTitle", 'avatarUrl', "thumbnailUrl", 'followers', "subscriberCount",
          'lastSync', ${iso('"updatedAt"')}
        )
        FROM "YoutubeAccount" WHERE "userId" = ${userId}
      ),
      'tiktok', (
        SELECT json_build_object(
          'id', id,
          'tokenExpiry', ${iso('"tokenExpiry"')},
          'refreshExpiry', ${iso('"refreshExpiry"')},
          'hasRefreshToken', coalesce("refreshToken", '') <> '',
          'username', username, 'name', "displayName",
          'avatarUrl', "avatarUrl", 'followers', "followerCount",
          'lastSync', ${iso('"updatedAt"')}
        )
        FROM "TiktokAccount" WHERE "userId" = ${userId}
      ),
      'bluesky', (
        SELECT json_build_object(
          'id', id, 'handle', handle, 'name', "displayName", 'status', status,
          'avatarUrl', "avatarUrl", 'followers', "followersCount",
          'lastSync', ${iso('"updatedAt"')}
        )
        FROM "BlueskyAccount" WHERE "userId" = ${userId}
      ),
      'google', (
        SELECT json_build_object(
          'tokenExpiry', ${iso('ga."tokenExpiry"')},
          'hasRefreshToken', coalesce(ga."refreshToken", '') <> '',
          'locations', (
            SELECT coalesce(json_agg(json_build_object(
              'id', l.id, 'title', l.title, 'selected', l.selected, 'canPost', l."canPost",
              'lastSync', ${iso('l."updatedAt"')}
            ) ORDER BY l.title), '[]'::json)
            FROM "GoogleBusinessLocation" l
            WHERE l."googleBusinessAccountId" = ga.id
          )
        )
        FROM "GoogleBusinessAccount" ga WHERE ga."userId" = ${userId}
      )
    )`
  }

  // withAccounts adds an `accounts` list per platform (used by /accounts/status).
  private buildConnections(c: any, now: Date, withAccounts = false): Array<PlatformConnection & { accounts?: any[] }> {
    const isExpired = (expiry: string | null) => !!expiry && new Date(expiry).getTime() <= now.getTime()
    const toNumber = (v: string | null | undefined) => (v ? Number(v) || 0 : null)
    const empty = (platform: string): PlatformConnection & { accounts?: any[] } => ({
      platform, connected: false, expired: false, needsAction: null,
      accountCount: 0, username: null, avatarUrl: null, followers: null,
      ...(withAccounts ? { accounts: [] } : {})
    })
    const accounts = (list: any[]) => (withAccounts ? { accounts: list } : {})

    const direct: Record<string, PlatformConnection & { accounts?: any[] }> = {}

    if (c.facebookPages.length) {
      const main = c.facebookPages.find((p: any) => p.isDefault) || c.facebookPages[0]
      direct.FACEBOOK = {
        ...empty('FACEBOOK'),
        connected: true,
        accountCount: c.facebookPages.length,
        username: main.pageName || main.pageId || null,
        ...accounts(c.facebookPages.map((p: any) => ({
          id: p.id, pageId: p.pageId, name: p.pageName || p.pageId, isDefault: p.isDefault, lastSync: p.lastSync
        })))
      }
    }

    if (c.linkedIn) {
      const expired = isExpired(c.linkedIn.tokenExpiry)
      direct.LINKEDIN = {
        ...empty('LINKEDIN'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        ...accounts([{ id: c.linkedIn.id, tokenExpiry: c.linkedIn.tokenExpiry, lastSync: c.linkedIn.lastSync }])
      }
    }

    // X and YouTube refresh their tokens on their own while a refresh token exists.
    if (c.x) {
      const expired = isExpired(c.x.tokenExpiry) && !c.x.hasRefreshToken
      direct.X = {
        ...empty('X'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        username: c.x.username || c.x.name || null,
        avatarUrl: c.x.avatarUrl || null,
        followers: toNumber(c.x.followers),
        ...accounts([{
          id: c.x.id, username: c.x.username, name: c.x.name, avatarUrl: c.x.avatarUrl,
          followers: toNumber(c.x.followers), lastSync: c.x.lastSync
        }])
      }
    }

    if (c.youtube) {
      const expired = isExpired(c.youtube.tokenExpiry) && !c.youtube.hasRefreshToken
      direct.YOUTUBE = {
        ...empty('YOUTUBE'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        username: c.youtube.username || null,
        avatarUrl: c.youtube.avatarUrl || null,
        followers: toNumber(c.youtube.followers),
        ...accounts([{
          id: c.youtube.id, channelTitle: c.youtube.username, avatarUrl: c.youtube.avatarUrl,
          subscribers: toNumber(c.youtube.followers), lastSync: c.youtube.lastSync
        }])
      }
    }

    if (c.tiktok) {
      // Usable while the refresh token is still valid (or the access token, if none).
      const expired = c.tiktok.hasRefreshToken
        ? isExpired(c.tiktok.refreshExpiry)
        : isExpired(c.tiktok.tokenExpiry)
      direct.TIKTOK = {
        ...empty('TIKTOK'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        username: c.tiktok.username || c.tiktok.name || null,
        avatarUrl: c.tiktok.avatarUrl || null,
        followers: toNumber(c.tiktok.followers),
        ...accounts([{
          id: c.tiktok.id, username: c.tiktok.username, name: c.tiktok.name, avatarUrl: c.tiktok.avatarUrl,
          followers: toNumber(c.tiktok.followers), lastSync: c.tiktok.lastSync
        }])
      }
    }

    if (c.bluesky) {
      // BlueskyService marks the row "expired" when the user must reconnect.
      const expired = c.bluesky.status === 'expired'
      direct.BLUESKY = {
        ...empty('BLUESKY'),
        connected: true,
        expired,
        needsAction: expired ? 'RECONNECT' : null,
        accountCount: 1,
        username: c.bluesky.handle || null,
        avatarUrl: c.bluesky.avatarUrl || null,
        followers: toNumber(c.bluesky.followers),
        ...accounts([{
          id: c.bluesky.id, handle: c.bluesky.handle, name: c.bluesky.name, avatarUrl: c.bluesky.avatarUrl,
          followers: toNumber(c.bluesky.followers), lastSync: c.bluesky.lastSync
        }])
      }
    }

    if (c.google) {
      // Same rule as GoogleBusinessService.status(): only a chosen,
      // postable location counts as connected.
      const expired = isExpired(c.google.tokenExpiry) && !c.google.hasRefreshToken
      const usable = c.google.locations.filter((l: any) => l.selected && l.canPost)
      direct.GOOGLE_BUSINESS = {
        ...empty('GOOGLE_BUSINESS'),
        connected: usable.length > 0,
        expired,
        needsAction: expired ? 'RECONNECT' : usable.length ? null : 'SELECT_LOCATION',
        accountCount: usable.length,
        username: usable[0]?.title || null,
        // All locations, so the page can show which ones to pick.
        ...accounts(c.google.locations)
      }
    }

    return SUPPORTED_PLATFORMS.map(platform => {
      if (DIRECT_PLATFORMS.includes(platform)) return direct[platform] || empty(platform)

      const rows = c.social.filter((a: any) => a.platform === platform)
      if (!rows.length) return empty(platform)
      const active = rows.filter((a: any) => a.status === 'active')
      const first = active[0] || rows[0]
      return {
        ...empty(platform),
        connected: active.length > 0,
        expired: active.length === 0,
        needsAction: active.length ? null : 'RECONNECT',
        accountCount: active.length,
        username: first.username || null,
        avatarUrl: first.avatarUrl || null,
        ...accounts(rows.map((a: any) => ({
          id: a.id, username: a.username, avatarUrl: a.avatarUrl, status: a.status, lastSync: a.lastSync,
          // Pinterest only.
          ...(platform === 'PINTEREST' ? { defaultBoardId: a.defaultBoardId, defaultBoardName: a.defaultBoardName } : {})
        })))
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

  // Activity is grouped per day in SQL for the last 7 days. Show only today's
  // entries when there are any, otherwise the whole 7 days. Newest first, max 3.
  private buildRecentActivity(rows: Array<{ type: string; platform: string | null; day: string; count: number; latest: string }>, today: string) {
    const todays = rows.filter(r => r.day === today)
    const chosen = todays.length ? todays : rows

    const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
    const message = (r: (typeof rows)[number]) => {
      const n = Number(r.count)
      switch (r.type) {
        case 'posts_generated': return `${plural(n, 'post')} generated`
        case 'posts_scheduled': return `${plural(n, 'post')} scheduled for optimal times`
        case 'post_published': return `${plural(n, 'post')} published — ${r.platform} completed`
        case 'post_failed': return `${plural(n, 'post')} failed to publish`
        default: return `${plural(n, 'reel')} queued`
      }
    }

    return chosen
      .map(r => ({ type: r.type, message: message(r), time: r.latest }))
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 3)
  }

  private buildBrandHealth(user: any, postedDaysCount: number, postedLast7Days: number) {
    const contentConsistency = Math.min(100, Math.round((postedDaysCount / 30) * 100))
    const postingFrequency = Math.min(100, Math.round((postedLast7Days / POSTING_FREQUENCY_TARGET_PER_WEEK) * 100))

    const checklist = [
      !!user?.brandName,
      !!user?.brandLogo,
      !!user?.hasLogo,
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
