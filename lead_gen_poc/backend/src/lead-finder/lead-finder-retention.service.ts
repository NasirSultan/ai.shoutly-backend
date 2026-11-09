import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { prisma } from '../lib/prisma'
import { leadFinderConfig } from './lead-finder.types'

// Data rule from the design: raw posts are kept 60-90 days. Deleting a post
// cascades to its pool links and to users' leads for it.
@Injectable()
export class LeadFinderRetentionService {
  private readonly logger = new Logger(LeadFinderRetentionService.name)

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldPosts() {
    const cutoff = new Date(Date.now() - leadFinderConfig().retentionDays * 86_400_000)
    const { count } = await prisma.socialRawPost.deleteMany({ where: { fetchedAt: { lt: cutoff } } })
    await prisma.leadPool.deleteMany({ where: { fetchedAt: { lt: cutoff } } })
    await prisma.profileCrawlJob.deleteMany({ where: { createdAt: { lt: cutoff } } })
    if (count) this.logger.log(`Deleted ${count} raw posts older than ${cutoff.toISOString()}`)
  }
}
