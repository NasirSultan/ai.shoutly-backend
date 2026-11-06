import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { AuthGuard } from '../common/guards/auth.guard'

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @UseGuards(AuthGuard)
  @Get()
  async getOverview(@Req() req) {
    return this.dashboardService.getOverview(req.user.id)
  }

  // Summary + current week + current month.
  @UseGuards(AuthGuard)
  @Get('autopilot')
  async getAutopilot(@Req() req) {
    return this.dashboardService.getAutopilot(req.user.id)
  }

  // Older periods: ?period=week|month&offset=1 (1 = last week/month).
  @UseGuards(AuthGuard)
  @Get('autopilot/history')
  async getAutopilotHistory(
    @Req() req,
    @Query('period') period: string,
    @Query('offset') offset: string
  ) {
    return this.dashboardService.getAutopilotHistory(req.user.id, period, offset)
  }
}
