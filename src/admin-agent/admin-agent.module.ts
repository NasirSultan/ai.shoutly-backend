import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AuditLogModule } from '../audit-log/audit-log.module'
import { AiUsageLogModule } from '../ai-usage/ai-usage-log.module'
import { RedisModule } from '../common/redis/redis.module'
import { MonitoringModule } from '../monitoring/monitoring.module'
import { AdminDashboardModule } from '../admin-dashboard/admin-dashboard.module'
import { AdminAgentController } from './admin-agent.controller'
import { AdminAgentService } from './admin-agent.service'

@Module({
  imports: [AuthModule, AuditLogModule, AiUsageLogModule, RedisModule, MonitoringModule, AdminDashboardModule],
  controllers: [AdminAgentController],
  providers: [AdminAgentService],
})
export class AdminAgentModule {}
