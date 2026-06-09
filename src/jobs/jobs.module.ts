import { Module, OnModuleInit } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { RedisModule } from '../common/redis/redis.module'
import { FacebookModule } from '../social-media/facebook/facebook.module'
import { JobsService } from './jobs.service'
import { PostQueue } from './post.queue'
import { PostWorker } from './post.worker'
import { BrevoModule } from '../brevo/brevo.module'
@Module({
  imports: [
    ScheduleModule.forRoot(),
    RedisModule,
    // FacebookModule,
    BrevoModule,
  ],
  providers: [JobsService, PostQueue, PostWorker],
})

  export class JobsModule implements OnModuleInit {
    // 2. Injecting the worker directly into the module's constructor hooks it into the active dependency tree
    constructor(private readonly postWorker: PostWorker) {}

    onModuleInit() {
      console.log('[JobsModule] Module successfully loaded and worker tracking activated! ✅');
    }
  }
  