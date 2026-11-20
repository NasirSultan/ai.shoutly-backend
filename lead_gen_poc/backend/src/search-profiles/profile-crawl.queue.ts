import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Queue } from 'bullmq'
import { RedisService } from '../common/redis/redis.service'

export const PROFILE_CRAWL_QUEUE = 'lead-finder-crawl'

@Injectable()
export class ProfileCrawlQueue implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<{ crawlJobId: string }>

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.queue = new Queue(PROFILE_CRAWL_QUEUE, {
      connection: this.redisService.createIORedisClient(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      },
    })
  }

  async onModuleDestroy() {
    await this.queue?.close()
  }

  // jobId = the crawl row id, so the same crawl can never be queued twice.
  add(crawlJobId: string) {
    return this.queue.add('crawl', { crawlJobId }, { jobId: crawlJobId })
  }
}
