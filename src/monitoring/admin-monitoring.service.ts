import { Injectable, NotFoundException } from '@nestjs/common'
import { prisma } from '../lib/prisma'
import { AuditLogService } from '../audit-log/audit-log.service'
import { AlertService } from './alert.service'
import { HealthService } from './health.service'
import { MonitoringService } from './monitoring.service'
import { PublishQueueService } from './publish-queue.service'
import { CRON_HEARTBEATS, CronName, STUCK_POSTING_MS } from './monitoring.constants'

interface Actor {
  id: string
  email: string
}

@Injectable()
export class AdminMonitoringService {
  constructor(
    private readonly health: HealthService,
    private readonly publishQueue: PublishQueueService,
    private readonly monitoring: MonitoringService,
    private readonly alerts: AlertService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Everything the admin monitoring page shows, in one call.
  async snapshot() {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

    const [health, queueCounts, failedJobs, postsToday, stuckPosts, heartbeats, serviceErrors, alerts] =
      await Promise.all([
        this.health.check(),
        this.publishQueue.getCounts().catch(() => null),
        this.publishQueue.getFailedJobs(20).catch(() => []),
        prisma.calendarPost.groupBy({
          by: ['status'],
          where: { postTime: { gte: startOfDay, lt: endOfDay } },
          _count: { _all: true },
        }),
        prisma.calendarPost.findMany({
          where: { status: 'POSTING', updatedAt: { lt: new Date(Date.now() - STUCK_POSTING_MS) } },
          select: { id: true, userId: true, postTime: true, updatedAt: true },
          orderBy: { updatedAt: 'asc' },
          take: 50,
        }),
        this.monitoring.getHeartbeats(),
        this.monitoring.getServiceErrorCounts(),
        this.alerts.history(50),
      ])

    return {
      health,
      queue: { counts: queueCounts, failedJobs },
      publishingToday: Object.fromEntries(postsToday.map((g) => [g.status, g._count._all])),
      stuckPosts,
      crons: (Object.keys(CRON_HEARTBEATS) as CronName[]).map((name) => ({
        name,
        label: CRON_HEARTBEATS[name].label,
        lastRunAt: heartbeats[name] ? new Date(heartbeats[name] as number).toISOString() : null,
        stale: this.monitoring.isCronStale(name, heartbeats[name]),
      })),
      serviceErrorsLast15Min: serviceErrors,
      alerts,
    }
  }

  async retryJob(jobId: string, actor: Actor) {
    const result = await this.publishQueue.retryJob(jobId)
    this.auditLog.log({ actor, action: 'MONITORING_JOB_RETRIED', targetType: 'PublishJob', targetId: jobId })
    return result
  }

  // Puts a post stuck in POSTING back to SCHEDULED so the scheduler picks it
  // up again on its next run (only if it's still due today).
  async resetStuckPost(postId: string, actor: Actor) {
    const result = await prisma.calendarPost.updateMany({
      where: { id: postId, status: 'POSTING' },
      data: { status: 'SCHEDULED' },
    })
    if (result.count === 0) throw new NotFoundException(`Post ${postId} is not stuck in POSTING`)
    this.auditLog.log({
      actor,
      action: 'MONITORING_POST_RESET',
      targetType: 'CalendarPost',
      targetId: postId,
      before: { status: 'POSTING' },
      after: { status: 'SCHEDULED' },
    })
    return { postId, status: 'SCHEDULED' }
  }
}
