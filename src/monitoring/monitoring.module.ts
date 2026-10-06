import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { BrevoModule } from '../brevo/brevo.module'
import { RedisModule } from '../common/redis/redis.module'
import { AdminMonitoringController } from './admin-monitoring.controller'
import { AdminMonitoringService } from './admin-monitoring.service'
import { AlertService } from './alert.service'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
import { PublishQueueService } from './publish-queue.service'
import { WatchdogService } from './watchdog.service'

// Health check, alerts, the watchdog and the admin monitoring API.
// (Heartbeats and error counters live in the global MonitoringCoreModule.)
@Module({
  imports: [AuthModule, AuditLogModule, BrevoModule, RedisModule],
  controllers: [HealthController, AdminMonitoringController],
  providers: [AlertService, HealthService, PublishQueueService, WatchdogService, AdminMonitoringService],
})
export class MonitoringModule {}
