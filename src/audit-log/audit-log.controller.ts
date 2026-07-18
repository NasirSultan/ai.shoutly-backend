import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('audit-logs')
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('actorEmail') actorEmail?: string,
  ) {
    return this.auditLogService.findAllForAdmin({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      action: action?.trim() || undefined,
      targetType: targetType?.trim() || undefined,
      actorEmail: actorEmail?.trim() || undefined,
    });
  }
}
