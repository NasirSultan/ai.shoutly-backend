import { Module, OnModuleInit } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { RedisModule } from '../common/redis/redis.module'
import { LinkedInModule } from '../social-media/linkedin/linkedin.module'
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