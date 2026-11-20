import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'
import { AiUsageLogModule } from '../ai-usage/ai-usage-log.module'
import { SearchProfilesController } from './search-profiles.controller'
import { SearchProfilesService } from './search-profiles.service'

@Module({
  imports: [AuthModule, RedisModule, AiUsageLogModule],
  controllers: [SearchProfilesController],
  providers: [SearchProfilesService],
})
export class SearchProfilesModule {}
