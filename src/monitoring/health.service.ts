import { Injectable } from '@nestjs/common'
import { prisma } from '../lib/prisma'
import { RedisService } from '../common/redis/redis.service'
import { PublishQueueService } from './publish-queue.service'
import { APP_VERSION } from './monitoring.constants'

const CHECK_TIMEOUT_MS = 2000

type CheckResult = 'up' | 'down'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ])
}

async function probe(check: () => Promise<unknown>): Promise<CheckResult> {
  try {
    await withTimeout(check(), CHECK_TIMEOUT_MS)
    return 'up'
  } catch {
    return 'down'
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly redisService: RedisService,
    private readonly publishQueue: PublishQueueService,
  ) {}

  // "down" (503) when the database or Redis is unreachable: the app can't work.
  // "degraded" (200) when only the queue check fails: the API still serves.
  async check() {
    const [database, redis, queue] = await Promise.all([
      probe(() => prisma.$queryRaw`SELECT 1`),
      probe(() => this.redisService.getClient().ping()),
      probe(() => this.publishQueue.getCounts()),
    ])

    const status = database === 'down' || redis === 'down' ? 'down' : queue === 'down' ? 'degraded' : 'ok'

    return {
      status,
      checks: { database, redis, queue },
      uptimeSeconds: Math.round(process.uptime()),
      version: APP_VERSION,
      time: new Date().toISOString(),
    }
  }
}
