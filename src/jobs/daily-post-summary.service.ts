import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import { RedisService } from '../common/redis/redis.service'
import { BrevoService } from '../brevo/brevo.service'
import { MonitoringService } from '../monitoring/monitoring.service'
import { normalizeTimezone } from '../common/utils/timezone.util'
import { buildPlatformRowsHtml, PlatformRowInput } from '../common/utils/email-template.util'
import { publishResultsKey, SavedPlatformResult } from './publish-results'

// The summary for a day goes out once the user's day is over, from this
// time (user's own timezone) onwards. Waiting a little past midnight lets
// posts scheduled near midnight finish first.
const SEND_AFTER = { hour: 0, minute: 30 }

// Days before this got per-post emails; no summary is sent for them.
const FIRST_SUMMARY_DAY = '2026-11-07'

const SENT_MARKER_TTL_SECONDS = 7 * 24 * 60 * 60

// One email per user per day: every post published (or tried) yesterday,
// with each platform shown as posted or failed. No failure reasons.
//
// Runs every 10 minutes rather than at one fixed time, so it still sends if
// the server was asleep (Render free plan) at that time: any run during the
// next day sends yesterday's summary. A Redis marker, set before sending,
// makes sure it is sent only once (even with overlapping runs or two
// servers); it is removed again if the send fails, so the next run retries.
@Injectable()
export class DailyPostSummaryService {
  private readonly logger = new Logger(DailyPostSummaryService.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly brevoService: BrevoService,
    private readonly monitoring: MonitoringService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sendDailySummaries() {
    // Users with a post that finished (or got stuck) in roughly the last two
    // days. Each one's "yesterday" is then worked out in their own timezone.
    const recent = await prisma.calendarPost.findMany({
      where: {
        status: { in: ['POSTED', 'FAILED', 'POSTING'] },
        updatedAt: { gte: new Date(Date.now() - 50 * 60 * 60 * 1000) },
      },
      select: { userId: true },
      distinct: ['userId'],
    })

    let sent = 0
    for (const { userId } of recent) {
      try {
        if (await this.sendForUser(userId)) sent++
      } catch (err) {
        this.logger.error(`Daily summary for user ${userId} failed: ${(err as Error).message}`)
      }
    }
    if (sent) this.logger.log(`Daily post summaries sent: ${sent}`)

    void this.monitoring.heartbeat('sendDailyPostSummaries')
  }

  // Returns true when an email was sent.
  private async sendForUser(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, timezone: true },
    })
    if (!user?.email) return false

    const tz = normalizeTimezone(user.timezone, 'Asia/Karachi')
    const now = DateTime.now().setZone(tz)
    if (now < now.startOf('day').set(SEND_AFTER)) return false

    const dayStart = now.minus({ days: 1 }).startOf('day')
    const day = dayStart.toISODate()!
    if (day < FIRST_SUMMARY_DAY) return false

    // A post belongs to the day it finished (updatedAt is set when its status
    // becomes POSTED/FAILED). Still POSTING means it got stuck: shown as failed.
    const posts = await prisma.calendarPost.findMany({
      where: {
        userId,
        status: { in: ['POSTED', 'FAILED', 'POSTING'] },
        updatedAt: { gte: dayStart.toJSDate(), lt: dayStart.plus({ days: 1 }).toJSDate() },
      },
      select: { id: true, status: true, postTime: true, updatedAt: true, targetPlatforms: true },
      orderBy: { postTime: 'asc' },
    })
    if (!posts.length) return false

    const client = this.redisService.getClient()
    const marker = `daily-summary:${userId}:${day}`
    const claimed = await client.set(marker, String(Date.now()), { NX: true, EX: SENT_MARKER_TTL_SECONDS })
    if (!claimed) return false

    try {
      const savedValues = await client.mGet(posts.map((p) => publishResultsKey(p.id)))
      const rows: PlatformRowInput[] = posts.flatMap((post, i) => {
        const time = DateTime.fromJSDate(post.status === 'POSTING' ? post.postTime : post.updatedAt)
          .setZone(tz)
          .toFormat("MMM dd, yyyy 'at' hh:mm a")
        const saved = this.parse(savedValues[i])
        if (saved?.length) {
          return saved.map((r) => ({
            platform: r.platform,
            accountName: r.accountName,
            postedAt: time,
            status: r.ok ? ('published' as const) : ('failed' as const),
          }))
        }
        // No saved results (published with "publish now", or the job never
        // got to any platform): one row per chosen platform, from the status.
        const status = post.status === 'POSTED' ? ('published' as const) : ('failed' as const)
        const platforms = post.targetPlatforms.length ? post.targetPlatforms : ['ALL']
        return platforms.map((platform) => ({
          platform: platform === 'ALL' ? 'All platforms' : platform,
          accountName: platform === 'ALL' ? 'Your connected accounts' : platform,
          postedAt: time,
          status,
        }))
      })

      await this.brevoService.sendPostPublishedEmail(user.email, user.name || 'Creator', buildPlatformRowsHtml(rows))
      return true
    } catch (err) {
      // Not sent: remove the marker so the next run tries again.
      await client.del(marker).catch(() => undefined)
      throw err
    }
  }

  private parse(value: string | null | undefined): SavedPlatformResult[] | null {
    if (!value) return null
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}
