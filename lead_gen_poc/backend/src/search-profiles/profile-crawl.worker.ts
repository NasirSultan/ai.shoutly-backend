import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Job, Worker } from 'bullmq'
import { RedisService } from '../common/redis/redis.service'
import { prisma } from '../lib/prisma'
import { mockWebsiteAnalysis } from './mock-website-analysis'
import { PROFILE_CRAWL_QUEUE } from './profile-crawl.queue'

const MOCK_DELAY_MS = 2_500

@Injectable()
export class ProfileCrawlWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfileCrawlWorker.name)
  private worker!: Worker<{ crawlJobId: string }>

  constructor(private readonly redisService: RedisService) {}

  onModuleInit() {
    this.worker = new Worker(PROFILE_CRAWL_QUEUE, (job) => this.process(job), {
      connection: this.redisService.createIORedisClient(),
      concurrency: 2,
    })
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }

  private async process(job: Job<{ crawlJobId: string }>) {
    const crawl = await prisma.profileCrawlJob.findUnique({ where: { id: job.data.crawlJobId } })
    if (!crawl || crawl.status === 'COMPLETED') return

    await prisma.profileCrawlJob.update({ where: { id: crawl.id }, data: { status: 'RUNNING' } })
    try {
      // MOCK: a real crawl + LLM analysis goes here.
      await new Promise((r) => setTimeout(r, MOCK_DELAY_MS))
      const result = mockWebsiteAnalysis(crawl.normalizedUrl)
      await prisma.profileCrawlJob.update({
        where: { id: crawl.id },
        data: { status: 'COMPLETED', result: result as any },
      })
    } catch (err: any) {
      this.logger.error(`Crawl ${crawl.id} failed: ${err?.message ?? err}`)
      await prisma.profileCrawlJob.update({
        where: { id: crawl.id },
        data: { status: 'FAILED', error: String(err?.message ?? err) },
      })
    }
  }
}
