import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'
import { AiUsageLogModule } from '../ai-usage/ai-usage-log.module'
import { ApifyModule } from '../lib/apify/apify.module'
import { LeadClassifierService } from './lead-classifier.service'
import { LeadFetchQueue } from './lead-fetch.queue'
import { LeadFetchWorker } from './lead-fetch.worker'
import { LeadFinderController } from './lead-finder.controller'
import { LeadFinderLimitsService } from './lead-finder-limits.service'
import { LeadFinderRetentionService } from './lead-finder-retention.service'
import { LeadFinderService } from './lead-finder.service'
import { FacebookSource } from './sources/facebook.source'
import { RedditSource } from './sources/reddit.source'

// Lead Finder: public Reddit/Facebook posts from people looking to hire.
// The fetch worker runs inside the API process, like the post publishing worker.
@Module({
  imports: [AuthModule, RedisModule, AiUsageLogModule, ApifyModule],
  controllers: [LeadFinderController],
  providers: [
    LeadFinderService,
    LeadFinderLimitsService,
    LeadFetchQueue,
    LeadFetchWorker,
    LeadClassifierService,
    LeadFinderRetentionService,
    RedditSource,
    FacebookSource,
  ],
})
export class LeadFinderModule {}
