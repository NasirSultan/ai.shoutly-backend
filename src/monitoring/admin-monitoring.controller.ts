import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminMonitoringService } from './admin-monitoring.service'

@Controller('admin/monitoring')
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
export class AdminMonitoringController {
  constructor(private readonly adminMonitoring: AdminMonitoringService) {}

  @Get()
  snapshot() {
    return this.adminMonitoring.snapshot()
  }

  @Post('jobs/:jobId/retry')
  retryJob(@Param('jobId') jobId: string, @Req() req) {
    return this.adminMonitoring.retryJob(jobId, req.user)
  }

  @Post('posts/:postId/reset')
  resetStuckPost(@Param('postId') postId: string, @Req() req) {
    return this.adminMonitoring.resetStuckPost(postId, req.user)
  }
}
