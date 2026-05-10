import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { createClient, RedisClientType } from 'redis'
import Redis from 'ioredis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: RedisClientType
  private ioRedisClients: Redis[] = []

  async onModuleInit() {
    console.log('REDIS_URL:', process.env.REDIS_URL)
    console.log('DATABASE_URL:', process.env.DATABASE_URL)

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
    })
    this.ioRedisClients.push(client)
    return client
  }
}