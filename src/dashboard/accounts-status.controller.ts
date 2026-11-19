import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { AuthGuard } from '../common/guards/auth.guard'

// GET /api/accounts/status — all 10 platforms with their accounts in one call.
@Controller('accounts')
export class AccountsStatusController {
  constructor(private readonly dashboardService: DashboardService) {}

  @UseGuards(AuthGuard)
  @Get('status')
  async getStatus(@Req() req) {
    return this.dashboardService.getAccountsStatus(req.user.id)
  }
}
