import { Module } from '@nestjs/common'
import { WebsiteWatcherController } from './website-watcher.controller'
import { WebsiteWatcherService } from './website-watcher.service'
import { AiUsageLogModule } from '../ai-usage/ai-usage-log.module'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'

@Module({
  imports: [AiUsageLogModule, AuthModule, RedisModule],
  controllers: [WebsiteWatcherController],
  providers: [WebsiteWatcherService],
})
export class WebsiteWatcherModule {}
