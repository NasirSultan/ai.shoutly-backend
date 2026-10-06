import { Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Queue } from 'bullmq'
import { RedisService } from '../common/redis/redis.service'
import { PUBLISH_QUEUE_NAME } from './monitoring.constants'

// Read-only view of the publishing queue for health checks and the admin
// page (plus retrying a failed job). It opens its own connection so the
// monitoring module doesn't depend on JobsModule.
@Injectable()
export class PublishQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.queue = new Queue(PUBLISH_QUEUE_NAME, { connection: this.redisService.createIORedisClient() })
  }

  async onModuleDestroy() {
    await this.queue?.close()
  }

  getCounts() {
    return this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
  }

  async getFailedJobs(limit = 20) {
    const jobs = await this.queue.getFailed(0, limit - 1)
    return jobs.map((job) => ({
      jobId: job.id,
      postId: job.data?.calendarPostId ?? null,
      error: job.failedReason ?? null,
      attempts: job.attemptsMade,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    }))
  }

  async retryJob(jobId: string) {
    const job = await this.queue.getJob(jobId)
    if (!job) throw new NotFoundException(`Job ${jobId} not found`)
    await job.retry('failed')
    return { jobId, retried: true }
  }
}
