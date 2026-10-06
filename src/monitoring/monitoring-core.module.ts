import { Global, Module } from '@nestjs/common'
import { RedisModule } from '../common/redis/redis.module'
import { MonitoringService } from './monitoring.service'

// Global so crons, the publishing worker and service clients can report to
// monitoring without importing it. It depends only on Redis, so modules it is
// injected into (e.g. BrevoModule) never form an import cycle with it.
@Global()
@Module({
  imports: [RedisModule],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringCoreModule {}
