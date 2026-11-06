import { Module } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { DashboardController } from './dashboard.controller'
import { AccountsStatusController } from './accounts-status.controller'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  providers: [DashboardService],
  controllers: [DashboardController, AccountsStatusController]
})
export class DashboardModule {}
