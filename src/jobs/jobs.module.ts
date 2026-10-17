import { Module, OnModuleInit } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { RedisModule } from '../common/redis/redis.module'
import { LinkedInModule } from '../social-media/linkedin/linkedin.module'
import { YoutubeModule } from '../social-media/youtube/youtube.module'
import { GoogleBusinessModule } from '../social-media/google-business/google-business.module'
import { XModule } from '../social-media/x/x.module'
import { TiktokModule } from '../social-media/tiktok/tiktok.module'
import { BlueskyModule } from '../social-media/bluesky/bluesky.module'
import { JobsService } from './jobs.service'
import { PostQueue } from './post.queue'
import { PostWorker } from './post.worker'
import { OnboardingDripService } from './onboarding-drip.service'
import { BrevoModule } from '../brevo/brevo.module'
@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule,
    LinkedInModule,
    YoutubeModule,
    GoogleBusinessModule,
    XModule,
    TiktokModule,
    BlueskyModule,
    BrevoModule,
  ],
  providers: [JobsService, PostQueue, PostWorker, OnboardingDripService],
  exports: [PostQueue],
})

  export class JobsModule implements OnModuleInit {
    // 2. Injecting the worker directly into the module's constructor hooks it into the active dependency tree
    constructor(private readonly postWorker: PostWorker) {}

    onModuleInit() {
      console.log('[JobsModule] Module successfully loaded and worker tracking activated! ✅');
    }
  }