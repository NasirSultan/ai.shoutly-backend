import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { createClient, RedisClientType } from 'redis'
import Redis from 'ioredis'

// Same shape as ai.shoutly-backend/src/common/redis/redis.service.ts, so the lead
// finder code runs unchanged against Shoutly's RedisService after integration.
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType
  private ioRedisClients: Redis[] = []

  async onModuleInit() {
    this.client = createClient({ url: process.env.REDIS_URL })
    await this.client.connect()
  }

  async onModuleDestroy() {
    await this.client.quit()
    await Promise.all(this.ioRedisClients.map((c) => c.quit()))
  }

  getClient() {
    return this.client
  }

  createIORedisClient() {
    const client = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableAutoPipelining: true,
    })

    client.on('error', (err) => console.error('❌ IORedis connection error:', err))

    this.ioRedisClients.push(client)
    return client
  }
}
