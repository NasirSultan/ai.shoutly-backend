import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('admin/dashboard')
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  @Get()
  getOverview() {
    return this.adminDashboardService.getOverview();
  }
}
