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

  async addPublishJob(calendarPostId: string) {
    return this.queue.add('publish', { calendarPostId }) // ✅ No jobId
  }

  // ✅ Add this method
  async obliterateQueue() {
    await this.queue.obliterate({ force: true })
    console.log('[Queue] All stuck jobs wiped from Redis')
  }
}