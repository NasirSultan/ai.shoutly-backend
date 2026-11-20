import { Module } from '@nestjs/common'
import { ProfileCrawlQueue } from './profile-crawl.queue'
import { ProfileCrawlWorker } from './profile-crawl.worker'
import { SearchProfilesController } from './search-profiles.controller'
import { SearchProfilesService } from './search-profiles.service'

@Module({
  controllers: [SearchProfilesController],
  providers: [SearchProfilesService, ProfileCrawlQueue, ProfileCrawlWorker],
})
export class SearchProfilesModule {}
