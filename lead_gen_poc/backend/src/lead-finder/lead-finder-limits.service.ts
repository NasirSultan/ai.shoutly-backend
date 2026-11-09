import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LeadPlatform } from '@prisma/client'
import { RedisService } from '../common/redis/redis.service'
import { prisma } from '../lib/prisma'
import { leadFinderConfig } from './lead-finder.types'

// Releases the lock only if we still own it, so a slow worker can never delete
// a lock that expired and was taken by someone else.
const RELEASE_LOCK_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`

/** Redis-backed lock and rate limits (the four Redis roles from the design, minus queues). */
@Injectable()
export class LeadFinderLimitsService {
  constructor(private readonly redis: RedisService) {}

  private get client() {
    return this.redis.getClient()
  }

  /** SET lock:<queryKey> <token> NX EX <ttl>. Returns the token, or null if someone else holds it. */
  async acquireFetchLock(queryKey: string, ttlSeconds: number): Promise<string | null> {
    const token = randomUUID()
    const ok = await this.client.sendCommand(['SET', `lf:lock:${queryKey}`, token, 'NX', 'EX', String(ttlSeconds)])
    return String(ok) === 'OK' ? token : null
  }

  async releaseFetchLock(queryKey: string, token: string): Promise<void> {
    await this.client.sendCommand(['EVAL', RELEASE_LOCK_SCRIPT, '1', `lf:lock:${queryKey}`, token])
  }

  /** The job the lock holder enqueued, so a waiting request can poll the same job. */
  async setLockedJob(queryKey: string, jobId: string, ttlSeconds: number) {
    await this.client.sendCommand(['SET', `lf:lockjob:${queryKey}`, jobId, 'EX', String(ttlSeconds)])
  }

  async getLockedJob(queryKey: string): Promise<string | null> {
    const v = await this.client.sendCommand(['GET', `lf:lockjob:${queryKey}`])
    return typeof v === 'string' ? v : null
  }

  /** Per-user limit on "Get leads", so one user can't keep forcing fetches and AI cost. */
  async takeUserFetch(userId: string): Promise<void> {
    const { userFetchesPerMin } = leadFinderConfig()
    const key = `lf:rl:user:${userId}:${Math.floor(Date.now() / 60_000)}`
    const count = Number(await this.client.sendCommand(['INCR', key]))
    if (count === 1) await this.client.sendCommand(['EXPIRE', key, '60'])
    if (count > userFetchesPerMin) {
      throw new HttpException('Please wait a moment before refreshing again.', HttpStatus.TOO_MANY_REQUESTS)
    }
  }

  /**
   * Global sliding-window cap on Apify runs per platform (one hour), plus a
   * daily usage row in Postgres for cost tracking.
   */
  async takeApifyCall(platform: LeadPlatform, endpoint: string): Promise<void> {
    const { apifyCallsPerHour } = leadFinderConfig()
    const key = `lf:rl:apify:${platform}`
    const now = Date.now()
    await this.client.sendCommand(['ZREMRANGEBYSCORE', key, '0', String(now - 3_600_000)])
    const used = Number(await this.client.sendCommand(['ZCARD', key]))
    if (used >= apifyCallsPerHour) {
      throw new Error(`Global ${platform} fetch limit reached (${apifyCallsPerHour}/hour)`)
    }
    await this.client.sendCommand(['ZADD', key, String(now), randomUUID()])
    await this.client.sendCommand(['EXPIRE', key, '3600'])

    const date = new Date().toISOString().slice(0, 10)
    await prisma.leadFinderApiUsage.upsert({
      where: { date_endpoint: { date, endpoint } },
      create: { date, endpoint, callCount: 1 },
      update: { callCount: { increment: 1 } },
    })
  }
}
