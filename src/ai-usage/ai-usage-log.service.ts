import { Injectable } from '@nestjs/common';
import { prisma } from '../lib/prisma';
import { estimateTextCostUsd, estimateImageCostUsd } from './pricing';
import { CSV_EXPORT_ROW_LIMIT } from '../common/utils/csv.util';

type Provider = 'GEMINI' | 'DEEPSEEK' | 'OPENAI';
type Operation = 'TEXT_GENERATION' | 'IMAGE_GENERATION' | 'EMBEDDING' | 'CHAT';

export interface LogTextUsageInput {
  userId?: string | null;
  provider: Provider;
  model: string;
  operation: Operation;
  promptTokens: number;
  completionTokens: number;
  metadata?: Record<string, any>;
}

export interface LogImageUsageInput {
  userId?: string | null;
  model: string;
  imageCount: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class AiUsageLogService {
  private prisma = prisma;

  // Fire-and-forget by design, same rationale as AuditLogService: a usage-log
  // write should never block or fail the AI call it's recording.
  logText(entry: LogTextUsageInput): void {
    const totalTokens = entry.promptTokens + entry.completionTokens;
    const estimatedCostUsd = estimateTextCostUsd(
      entry.provider,
      entry.model,
      entry.promptTokens,
      entry.completionTokens,
    );

    this.prisma.aiUsageLog
      .create({
        data: {
          userId: entry.userId ?? undefined,
          provider: entry.provider,
          model: entry.model,
          operation: entry.operation,
          promptTokens: entry.promptTokens,
          completionTokens: entry.completionTokens,
          totalTokens,
          estimatedCostUsd,
          metadata: entry.metadata ?? undefined,
        },
      })
      .catch((err) => {
        console.error('[AiUsageLog] Failed to write text usage entry', err);
      });
  }

  logImage(entry: LogImageUsageInput): void {
    const estimatedCostUsd = estimateImageCostUsd(entry.model, entry.imageCount);

    this.prisma.aiUsageLog
      .create({
        data: {
          userId: entry.userId ?? undefined,
          provider: 'GEMINI',
          model: entry.model,
          operation: 'IMAGE_GENERATION',
          imageCount: entry.imageCount,
          estimatedCostUsd,
          metadata: entry.metadata ?? undefined,
        },
      })
      .catch((err) => {
        console.error('[AiUsageLog] Failed to write image usage entry', err);
      });
  }

  async findAllForExport(opts: { provider?: string; operation?: string; userId?: string }) {
    const { provider, operation, userId } = opts;

    const where: Record<string, any> = {};
    if (provider) where.provider = provider;
    if (operation) where.operation = operation;
    if (userId) where.userId = userId;

    return this.prisma.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: CSV_EXPORT_ROW_LIMIT,
    });
  }

  async getSummaryForAdmin(opts: {
    page: number;
    limit: number;
    provider?: string;
    operation?: string;
    userId?: string;
  }) {
    const { page, limit, provider, operation, userId } = opts;
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {};
    if (provider) where.provider = provider;
    if (operation) where.operation = operation;
    if (userId) where.userId = userId;

    const [total, rows, totalsAgg, byProvider] = await Promise.all([
      this.prisma.aiUsageLog.count({ where }),
      this.prisma.aiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.aiUsageLog.aggregate({
        where,
        _sum: { estimatedCostUsd: true, totalTokens: true, imageCount: true },
        _count: { _all: true },
      }),
      this.prisma.aiUsageLog.groupBy({
        by: ['provider'],
        where,
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
      }),
    ]);

    return {
      data: rows,
      summary: {
        totalCalls: totalsAgg._count._all,
        totalCostUsd: totalsAgg._sum.estimatedCostUsd ?? 0,
        totalTokens: totalsAgg._sum.totalTokens ?? 0,
        totalImages: totalsAgg._sum.imageCount ?? 0,
        byProvider: byProvider.map((p) => ({
          provider: p.provider,
          calls: p._count._all,
          costUsd: p._sum.estimatedCostUsd ?? 0,
        })),
      },
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
