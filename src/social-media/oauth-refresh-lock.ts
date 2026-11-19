import { BadRequestException } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';

export async function withRefreshLock<T>(redis: RedisService, platform: string, userId: string, run: () => Promise<T>): Promise<T> {
  const key = `oauth-refresh:${platform}:${userId}`;
  const client = redis.getClient();
  for (let attempt = 0; attempt < 25; attempt++) {
    const got = await client.set(key, '1', { NX: true, EX: 20 });
    if (got) {
      try {
        return await run();
      } finally {
        await client.del(key);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new BadRequestException('The account is refreshing. Try again in a moment.');
}
