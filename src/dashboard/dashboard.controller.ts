import { Controller, Get, Req, UseGuards } from '@nestjs/common'
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
}
