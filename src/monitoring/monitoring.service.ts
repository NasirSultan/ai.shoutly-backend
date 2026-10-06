import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '../common/redis/redis.service'
import {
  CRON_HEARTBEATS,
  CronName,
  EXTERNAL_SERVICES,
  ExternalService,
  REDIS_KEYS,
  SERVICE_ERROR_WINDOW_MS,
} from './monitoring.constants'

// What the rest of the app reports to monitoring: cron heartbeats and
// outside-service failures. Every method is safe to call without awaiting
// and never throws, so monitoring can't break the code it watches.
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name)

  constructor(private readonly redisService: RedisService) {}

  // Called by a cron after it finishes successfully.
  async heartbeat(name: CronName) {
    try {
      await this.redisService.getClient().set(REDIS_KEYS.heartbeat(name), String(Date.now()))
    } catch (err) {
      this.logger.warn(`Could not record heartbeat for ${name}: ${(err as Error).message}`)
    }
  }

  // Called when a request to an outside service fails. Counts per 15 minutes.
  async recordServiceError(service: ExternalService) {
    try {
      const client = this.redisService.getClient()
      const key = REDIS_KEYS.serviceErrors(service)
      const count = await client.incr(key)
      if (count === 1) await client.pExpire(key, SERVICE_ERROR_WINDOW_MS)
    } catch (err) {
      this.logger.warn(`Could not record ${service} error: ${(err as Error).message}`)
    }
  }

  async getHeartbeats(): Promise<Record<CronName, number | null>> {
    const names = Object.keys(CRON_HEARTBEATS) as CronName[]
    const values = await this.redisService.getClient().mGet(names.map((n) => REDIS_KEYS.heartbeat(n)))
    return Object.fromEntries(names.map((n, i) => [n, values[i] ? Number(values[i]) : null])) as Record<
      CronName,
      number | null
    >
  }

  async getServiceErrorCounts(): Promise<Record<ExternalService, number>> {
    const values = await this.redisService.getClient().mGet(EXTERNAL_SERVICES.map((s) => REDIS_KEYS.serviceErrors(s)))
    return Object.fromEntries(EXTERNAL_SERVICES.map((s, i) => [s, Number(values[i]) || 0])) as Record<
      ExternalService,
      number
    >
  }

  // A cron counts as stopped when its last heartbeat is too old. Right after
  // a (re)start, including Render's free plan waking up, a cron that hasn't
  // run yet only counts as stopped once the process has been up long enough.
  isCronStale(name: CronName, lastRunAt: number | null, now = Date.now()) {
    const { staleAfterMs } = CRON_HEARTBEATS[name]
    if (lastRunAt) return now - lastRunAt > staleAfterMs && process.uptime() * 1000 > staleAfterMs
    return process.uptime() * 1000 > staleAfterMs
  }
}
