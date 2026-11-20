import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { RedisModule } from './common/redis/redis.module'
import { LeadFinderModule } from './lead-finder/lead-finder.module'
import { SearchProfilesModule } from './search-profiles/search-profiles.module'

// To integrate into ai.shoutly-backend: copy src/lead-finder, src/search-profiles,
// src/lib/apify and src/lib/llm/openrouter.service.ts, add LeadFinderModule and
// SearchProfilesModule to its AppModule imports, and swap DemoUserGuard for AuthGuard.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    RedisModule,
    SearchProfilesModule,
    LeadFinderModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
