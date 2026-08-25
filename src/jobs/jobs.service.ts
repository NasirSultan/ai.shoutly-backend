import { Injectable, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { DateTime } from 'luxon'
import { PostQueue } from './post.queue'
import { prisma } from '../lib/prisma'
import { normalizeTimezone } from '../common/utils/timezone.util'
const BATCH_SIZE = 10

@Injectable()
export class JobsService {  // ← Add implements OnModuleInit

  constructor(private readonly postQueue: PostQueue) {}

  // ✅ Runs once automatically on server start — DELETE after one deploy

  @Cron(CronExpression.EVERY_MINUTE)
  async checkDuePosts() {
    console.log('[Scheduler] Checking for due posts via Outstand channels...')

    let totalEnqueued = 0
    let totalMissed = 0

    while (true) {
      // 🎯 UPDATED QUERY: Look for users with active generic Outstand social accounts
      const duePosts = await prisma.calendarPost.findMany({
        where: {
          postTime: { lte: new Date() },
          status: 'SCHEDULED',
          user: {
            socialAccounts: {
              some: { status: 'active' } // Matches entries created by saveDirectConnection or finalizeTwoStepConnection
            }
          },
        },
        select: { id: true, postTime: true, user: { select: { timezone: true } } },
        take: BATCH_SIZE,
      })

      if (!duePosts.length) break

      // Split into posts still due "today" (in the user's own timezone) vs.
      // posts that missed their window on an earlier day — e.g. a calendar
      // built days before the user ever connected an account. Those should
      // never be published late; they're marked SKIP instead.
      const missedIds: string[] = []
      const readyIds: string[] = []

      for (const post of duePosts) {
        const tz = normalizeTimezone(post.user.timezone)
        const startOfToday = DateTime.now().setZone(tz).startOf('day')
        const postTimeInTz = DateTime.fromJSDate(post.postTime).setZone(tz)

        if (postTimeInTz < startOfToday) {
          missedIds.push(post.id)
        } else {
          readyIds.push(post.id)
        }
      }

      if (missedIds.length) {
        await prisma.calendarPost.updateMany({
          where: { id: { in: missedIds }, status: 'SCHEDULED' },
          data: { status: 'SKIP' },
        })
        totalMissed += missedIds.length
        console.log(`[Scheduler] Marked missed (stale, pre-today): ${missedIds.length}`)
      }

      if (readyIds.length) {
        // State Locking: Lock status immediately to prevent multi-worker processing overlap
        await prisma.calendarPost.updateMany({
          where: { id: { in: readyIds }, status: 'SCHEDULED' },
          data: { status: 'POSTING' },
        })

        // Offload to BullMQ Redis Queue
        await Promise.all(readyIds.map((id) => this.postQueue.addPublishJob(id)))

        totalEnqueued += readyIds.length
        console.log(`[Scheduler] Batch enqueued: ${readyIds.length} | Total: ${totalEnqueued}`)
      }
    }

    if (totalEnqueued > 0 || totalMissed > 0) {
      console.log(`[Scheduler] Done. Total enqueued: ${totalEnqueued} | Total missed: ${totalMissed}`)
    }
  }
}