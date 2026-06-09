import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { createClient, RedisClientType } from 'redis'
import Redis from 'ioredis'

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
      tls: {}, // ← Required for Upstash (rediss:// endpoint)
      enableAutoPipelining: true, // ← Recommended for Upstash latency
    })

    client.on('connect', () => console.log('✅ IORedis connected to Upstash'))
    client.on('error', (err) => console.error('❌ IORedis connection error:', err))

    this.ioRedisClients.push(client)
    return client
  }
}