import { Module } from '@nestjs/common'
import { WebsiteWatcherController } from './website-watcher.controller'
import { WebsiteWatcherService } from './website-watcher.service'
import { AiUsageLogModule } from '../ai-usage/ai-usage-log.module'

@Module({
  imports: [AiUsageLogModule],
  controllers: [WebsiteWatcherController],
  providers: [WebsiteWatcherService],
})
export class WebsiteWatcherModule {}
