import { Injectable, OnModuleInit } from '@nestjs/common'
import { Queue } from 'bullmq'
import { RedisService } from '../common/redis/redis.service'

@Injectable()
export class PostQueue implements OnModuleInit {
  private queue!: Queue

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.queue = new Queue('facebook-post', {
      connection: this.redisService.createIORedisClient(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    })
  }

  // One job per post: BullMQ ignores an add whose jobId is already in the
  // queue, so the same post can't be queued twice (e.g. by overlapping cron
  // runs or two server instances). Failed jobs are kept (removeOnFail: false),
  // so a leftover failed job for this post is removed first; otherwise it
  // would silently block the post from ever being queued again.
  async addPublishJob(calendarPostId: string) {
    const jobId = `publish-${calendarPostId}`
    const existing = await this.queue.getJob(jobId)
    if (existing && (await existing.isFailed())) {
      await existing.remove()
    }
    return this.queue.add('publish', { calendarPostId }, { jobId })
  }

  // ✅ Add this method
  async obliterateQueue() {
    await this.queue.obliterate({ force: true })
    console.log('[Queue] All stuck jobs wiped from Redis')
  }
}