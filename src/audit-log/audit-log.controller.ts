import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuditLogService } from './audit-log.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { toCsv } from '../common/utils/csv.util';

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

  @Get('export')
  async exportCsv(
    @Query('action') action: string | undefined,
    @Query('targetType') targetType: string | undefined,
    @Query('actorEmail') actorEmail: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.auditLogService.findAllForExport({
      action: action?.trim() || undefined,
      targetType: targetType?.trim() || undefined,
      actorEmail: actorEmail?.trim() || undefined,
    });
    const csv = toCsv(rows, [
      { key: 'createdAt', header: 'Time', value: (r) => new Date(r.createdAt).toISOString() },
      { key: 'actorEmail', header: 'Actor Email' },
      { key: 'action', header: 'Action' },
      { key: 'targetType', header: 'Target Type' },
      { key: 'targetId', header: 'Target ID' },
      { key: 'before', header: 'Before' },
      { key: 'after', header: 'After' },
      { key: 'ip', header: 'IP' },
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
    res.send(csv);
  }
}
