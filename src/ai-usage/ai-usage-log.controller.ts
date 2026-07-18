import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AiUsageLogService } from './ai-usage-log.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { toCsv } from '../common/utils/csv.util';

@Controller('ai-usage')
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
export class AiUsageLogController {
  constructor(private readonly aiUsageLogService: AiUsageLogService) {}

  @Get()
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('provider') provider?: string,
    @Query('operation') operation?: string,
    @Query('userId') userId?: string,
  ) {
    return this.aiUsageLogService.getSummaryForAdmin({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      provider: provider?.trim() || undefined,
      operation: operation?.trim() || undefined,
      userId: userId?.trim() || undefined,
    });
  }

  @Get('export')
  async exportCsv(
    @Query('provider') provider: string | undefined,
    @Query('operation') operation: string | undefined,
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.aiUsageLogService.findAllForExport({
      provider: provider?.trim() || undefined,
      operation: operation?.trim() || undefined,
      userId: userId?.trim() || undefined,
    });
    const csv = toCsv(rows, [
      { key: 'createdAt', header: 'Time', value: (r) => new Date(r.createdAt).toISOString() },
      { key: 'provider', header: 'Provider' },
      { key: 'model', header: 'Model' },
      { key: 'operation', header: 'Operation' },
      { key: 'promptTokens', header: 'Prompt Tokens' },
      { key: 'completionTokens', header: 'Completion Tokens' },
      { key: 'totalTokens', header: 'Total Tokens' },
      { key: 'imageCount', header: 'Images' },
      { key: 'estimatedCostUsd', header: 'Estimated Cost (USD)' },
      { key: 'userId', header: 'User ID' },
    ]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-usage.csv"');
    res.send(csv);
  }
}
