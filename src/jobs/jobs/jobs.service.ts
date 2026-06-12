import { Injectable, OnModuleInit } from '@nestjs/common'  // ← Add OnModuleInit
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaClient } from '@prisma/client'
import { PostQueue } from './post.queue'

const prisma = new PrismaClient()
const BATCH_SIZE = 10

@Injectable()
export class JobsService {  // ← Add implements OnModuleInit

  constructor(private readonly postQueue: PostQueue) {}

  // ✅ Runs once automatically on server start — DELETE after one deploy

  @Cron(CronExpression.EVERY_MINUTE)
  async checkDuePosts() {
    console.log('[Scheduler] Checking for due posts via Outstand channels...')

    let totalEnqueued = 0

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
        select: { id: true },
        take: BATCH_SIZE,
      })

      if (!duePosts.length) break

      const postIds = duePosts.map((p) => p.id)

      // State Locking: Lock status immediately to prevent multi-worker processing overlap
      await prisma.calendarPost.updateMany({
        where: { id: { in: postIds }, status: 'SCHEDULED' },
        data: { status: 'POSTING' },
      })

      // Offload to BullMQ Redis Queue
      await Promise.all(postIds.map((id) => this.postQueue.addPublishJob(id)))

      totalEnqueued += postIds.length
      console.log(`[Scheduler] Batch enqueued: ${postIds.length} | Total: ${totalEnqueued}`)
    }

    if (totalEnqueued > 0) {
      console.log(`[Scheduler] Done. Total enqueued: ${totalEnqueued}`)
    }
  }
}