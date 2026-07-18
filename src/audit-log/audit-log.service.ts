import { Injectable } from '@nestjs/common';
import { prisma } from '../lib/prisma';

export interface AuditActor {
  id: string;
  email: string;
  name?: string;
}

export interface LogEntryInput {
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId: string;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  ip?: string | null;
}

@Injectable()
export class AuditLogService {
  private prisma = prisma;

  // Fire-and-forget by design: an audit-log write should never block or fail
  // the admin action it's recording.
  log(entry: LogEntryInput): void {
    this.prisma.auditLog
      .create({
        data: {
          actorId: entry.actor.id,
          actorEmail: entry.actor.email,
          actorName: entry.actor.name,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          before: entry.before ?? undefined,
          after: entry.after ?? undefined,
          ip: entry.ip ?? undefined,
        },
      })
      .catch((err) => {
        console.error('[AuditLog] Failed to write audit log entry', err);
      });
  }

  async findAllForAdmin(opts: {
    page: number;
    limit: number;
    action?: string;
    targetType?: string;
    actorEmail?: string;
  }) {
    const { page, limit, action, targetType, actorEmail } = opts;
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {};
    if (action) where.action = action;
    if (targetType) where.targetType = targetType;
    if (actorEmail) where.actorEmail = { contains: actorEmail, mode: 'insensitive' };

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
