import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { RedisService } from '../common/redis/redis.service'
import { BrevoService } from '../brevo/brevo.service'
import { escapeHtml } from '../common/utils/email-template.util'
import { captureError } from './sentry'
import { ALERT_HISTORY_SIZE, ALERT_THROTTLE_MS, APP_VERSION, REDIS_KEYS } from './monitoring.constants'

export type AlertSeverity = 'critical' | 'warning'

export interface AlertInput {
  // Identifies the problem, e.g. "stuck-posting". Repeats of the same key
  // within 30 minutes are recorded but not emailed again.
  key: string
  severity: AlertSeverity
  title: string
  details?: string[]
}

export interface AlertRecord extends AlertInput {
  id: string
  createdAt: string
  emailed: boolean
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name)

  constructor(
    private readonly redisService: RedisService,
    private readonly brevoService: BrevoService,
  ) {}

  // Records the alert and emails ALERT_EMAILS unless the same problem was
  // already emailed in the last 30 minutes. Never throws.
  async notify(alert: AlertInput) {
    const log = `[${alert.severity.toUpperCase()}] ${alert.title}${alert.details?.length ? ` | ${alert.details.join(' | ')}` : ''}`
    if (alert.severity === 'critical') this.logger.error(log)
    else this.logger.warn(log)

    try {
      const client = this.redisService.getClient()
      const fresh = await client.set(REDIS_KEYS.alertThrottle(alert.key), '1', { NX: true, PX: ALERT_THROTTLE_MS })

      const record: AlertRecord = { ...alert, id: randomUUID(), createdAt: new Date().toISOString(), emailed: !!fresh }
      await client.lPush(REDIS_KEYS.alertHistory, JSON.stringify(record))
      await client.lTrim(REDIS_KEYS.alertHistory, 0, ALERT_HISTORY_SIZE - 1)

      if (fresh) await this.email(record)
    } catch (err) {
      // If Brevo itself is the problem the email can't go out; Sentry still
      // receives it (Sentry emails independently of Brevo).
      captureError(err, 'alerts', { alert })
    }
  }

  async history(limit = 50): Promise<AlertRecord[]> {
    const items = await this.redisService.getClient().lRange(REDIS_KEYS.alertHistory, 0, limit - 1)
    return items.flatMap((item) => {
      try {
        return [JSON.parse(item) as AlertRecord]
      } catch {
        return []
      }
    })
  }

  private async email(alert: AlertRecord) {
    const recipients = (process.env.ALERT_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
    if (!recipients.length) {
      this.logger.warn('ALERT_EMAILS is not set; alert was recorded but not emailed.')
      return
    }

    const tag = alert.severity === 'critical' ? 'CRITICAL' : 'WARNING'
    const subject = `[Shoutly ${tag}] ${alert.title}`
    const details = alert.details ?? []
    const footer = `Sent ${alert.createdAt.replace('T', ' ').slice(0, 16)} UTC · version ${APP_VERSION}`

    const htmlContent =
      `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">` +
      `<p style="margin:0 0 8px;font-weight:bold;color:${alert.severity === 'critical' ? '#b91c1c' : '#b45309'}">${tag}</p>` +
      `<p style="margin:0 0 12px;font-size:16px;font-weight:bold">${escapeHtml(alert.title)}</p>` +
      (details.length ? `<ul>${details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` : '') +
      `<p style="color:#666">Details and actions are on the admin monitoring page.</p>` +
      `<p style="color:#999;font-size:12px">${escapeHtml(footer)}</p></div>`
    const textContent = `${tag}: ${alert.title}\n\n${details.map((d) => `- ${d}`).join('\n')}\n\n${footer}\n`

    for (const email of recipients) {
      await this.brevoService.sendHtmlEmail({ to: { email }, subject, htmlContent, textContent })
    }
  }
}
