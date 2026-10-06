import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { prisma } from '../lib/prisma'
import { RedisService } from '../common/redis/redis.service'
import { AlertService } from './alert.service'
import { MonitoringService } from './monitoring.service'
import { PublishQueueService } from './publish-queue.service'
import { captureError } from './sentry'
import {
  CRON_HEARTBEATS,
  CronName,
  EXTERNAL_SERVICES,
  QUEUE_BACKLOG_THRESHOLD,
  REDIS_KEYS,
  SERVICE_ERROR_THRESHOLD,
  STUCK_POSTING_MS,
  UNLINKED_PAYMENT_MS,
} from './monitoring.constants'

const ids = (rows: { id: string }[]) => rows.map((r) => r.id.slice(0, 8)).join(', ')

// Runs the alert rules every 5 minutes. Each rule is independent: one failing
// rule is reported to Sentry and the others still run.
@Injectable()
export class WatchdogService {
  private readonly logger = new Logger(WatchdogService.name)

  constructor(
    private readonly alerts: AlertService,
    private readonly monitoring: MonitoringService,
    private readonly publishQueue: PublishQueueService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    const rules: [string, () => Promise<void>][] = [
      ['failed-posts', () => this.checkFailedPosts()],
      ['stuck-posting', () => this.checkStuckPosts()],
      ['queue-backlog', () => this.checkQueueBacklog()],
      ['cron-heartbeats', () => this.checkCronHeartbeats()],
      ['unlinked-payments', () => this.checkUnlinkedPayments()],
      ['service-errors', () => this.checkServiceErrors()],
    ]
    for (const [name, rule] of rules) {
      try {
        await rule()
      } catch (err) {
        this.logger.error(`Watchdog rule ${name} failed: ${(err as Error).message}`)
        captureError(err, 'watchdog', { rule: name })
      }
    }
  }

  // Rule 1: posts that ended up FAILED (after all retries) since the last run.
  private async checkFailedPosts() {
    const client = this.redisService.getClient()
    const now = new Date()
    const last = await client.get(REDIS_KEYS.lastFailedPostsCheck)
    await client.set(REDIS_KEYS.lastFailedPostsCheck, String(now.getTime()))
    // First run: start counting from now instead of alerting on old failures.
    if (!last) return

    const failed = await prisma.calendarPost.findMany({
      where: { status: 'FAILED', updatedAt: { gt: new Date(Number(last)), lte: now } },
      select: { id: true },
      take: 50,
    })
    if (!failed.length) return

    await this.alerts.notify({
      key: 'failed-posts',
      severity: 'warning',
      title: `${failed.length} scheduled post${failed.length === 1 ? '' : 's'} failed to publish`,
      details: [`Post ids: ${ids(failed)}`, 'Failed after all retries. The error for each is on the admin monitoring page.'],
    })
  }

  // Rule 2: posts claimed for publishing but never finished.
  private async checkStuckPosts() {
    const stuck = await prisma.calendarPost.findMany({
      where: { status: 'POSTING', updatedAt: { lt: new Date(Date.now() - STUCK_POSTING_MS) } },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    })
    if (!stuck.length) return

    const oldestMin = Math.round((Date.now() - stuck[0].updatedAt.getTime()) / 60000)
    await this.alerts.notify({
      key: 'stuck-posting',
      severity: 'critical',
      title: `${stuck.length} post${stuck.length === 1 ? '' : 's'} stuck in POSTING for over 15 minutes`,
      details: [
        `Oldest: ${oldestMin} min. Post ids: ${ids(stuck)}`,
        'Likely cause: the queue or worker is not running. They can be reset from the admin monitoring page.',
      ],
    })
  }

  // Rule 3: jobs piling up in the publishing queue.
  private async checkQueueBacklog() {
    const counts = await this.publishQueue.getCounts()
    if ((counts.waiting ?? 0) <= QUEUE_BACKLOG_THRESHOLD) return

    await this.alerts.notify({
      key: 'queue-backlog',
      severity: 'critical',
      title: `${counts.waiting} jobs waiting in the publishing queue`,
      details: [`Active: ${counts.active ?? 0}, failed: ${counts.failed ?? 0}`, 'The worker may be stuck or too slow.'],
    })
  }

  // Rule 4: a cron that has stopped running.
  private async checkCronHeartbeats() {
    const heartbeats = await this.monitoring.getHeartbeats()
    for (const name of Object.keys(CRON_HEARTBEATS) as CronName[]) {
      const lastRunAt = heartbeats[name]
      if (!this.monitoring.isCronStale(name, lastRunAt)) continue

      await this.alerts.notify({
        key: `cron-stale:${name}`,
        severity: 'critical',
        title: `Scheduled job stopped: ${CRON_HEARTBEATS[name].label}`,
        details: [lastRunAt ? `Last successful run: ${new Date(lastRunAt).toISOString()}` : 'No successful run since the server started.'],
      })
    }
  }

  // Rule 5: paid for, but no plan was created.
  private async checkUnlinkedPayments() {
    const unlinked = await prisma.payment.findMany({
      where: { status: 'PAID', subscriptionId: null, paidAt: { lt: new Date(Date.now() - UNLINKED_PAYMENT_MS) } },
      select: { id: true },
      take: 50,
    })
    if (!unlinked.length) return

    await this.alerts.notify({
      key: 'unlinked-payments',
      severity: 'critical',
      title: `${unlinked.length} paid payment${unlinked.length === 1 ? ' has' : 's have'} no plan`,
      details: [`Payment ids: ${ids(unlinked)}`, 'The customer paid but no subscription was created. Check the Razorpay webhook.'],
    })
  }

  // Rules 6 and 7: an outside service failing repeatedly. Brevo is critical
  // because it also sends OTP codes; while it's failing this email may not arrive.
  private async checkServiceErrors() {
    const counts = await this.monitoring.getServiceErrorCounts()
    for (const service of EXTERNAL_SERVICES) {
      const count = counts[service]
      if (count < SERVICE_ERROR_THRESHOLD) continue

      await this.alerts.notify({
        key: `service-errors:${service}`,
        severity: service === 'brevo' ? 'critical' : 'warning',
        title: `${count} ${service} errors in the last 15 minutes`,
        details:
          service === 'brevo'
            ? ['Emails (including login codes) may not be sending. Check the Brevo dashboard, e.g. authorised IPs.']
            : [`Requests to ${service} are failing. Check the service status and API key.`],
      })
    }
  }
}
