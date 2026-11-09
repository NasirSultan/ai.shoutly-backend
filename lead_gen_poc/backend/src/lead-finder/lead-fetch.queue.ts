import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Job, Queue } from 'bullmq'
import { RedisService } from '../common/redis/redis.service'
import { LeadFetchJobData, LeadFetchJobResult } from './lead-finder.types'

export const LEAD_FETCH_QUEUE = 'lead-finder-fetch'

// Same pattern as Shoutly's PostQueue: a deterministic jobId makes a duplicate
// enqueue a no-op. Failed jobs are kept for a day (the dead-letter view).
@Injectable()
export class LeadFetchQueue implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<LeadFetchJobData, LeadFetchJobResult>

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.queue = new Queue(LEAD_FETCH_QUEUE, {
      connection: this.redisService.createIORedisClient(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600 },
        removeOnFail: { age: 86_400 },
      },
    })
  }

  async onModuleDestroy() {
    await this.queue?.close()
  }

  async add(data: LeadFetchJobData, jobId: string) {
    const existing = await this.queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      // A finished job with this id is from earlier in the same window; replace it.
      if (state === 'failed' || state === 'completed') await existing.remove()
      else return existing
    }
    return this.queue.add('fetch', data, { jobId })
  }

  getJob(jobId: string): Promise<Job<LeadFetchJobData, LeadFetchJobResult> | undefined> {
    return this.queue.getJob(jobId)
  }
}
