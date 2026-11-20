import { Module } from '@nestjs/common'
import { ApifyModule } from '../lib/apify/apify.module'
import { LlmModule } from '../lib/llm/llm.module'
import { LeadClassifierService } from './lead-classifier.service'
import { LeadFetchQueue } from './lead-fetch.queue'
import { LeadFetchWorker } from './lead-fetch.worker'
import { LeadFinderController } from './lead-finder.controller'
import { LeadFinderLimitsService } from './lead-finder-limits.service'
import { LeadFinderRetentionService } from './lead-finder-retention.service'
import { LeadFinderService } from './lead-finder.service'
import { FacebookSource } from './sources/facebook.source'
import { RedditSource } from './sources/reddit.source'

@Module({
  imports: [ApifyModule, LlmModule],
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
