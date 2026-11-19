import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RedisModule } from '../../common/redis/redis.module';
import { BlueskyController } from './bluesky.controller';
import { BlueskyService } from './bluesky.service';
import { BlueskyOAuthService } from './bluesky-oauth.service';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [BlueskyController],
  providers: [BlueskyService, BlueskyOAuthService],
  exports: [BlueskyService, BlueskyOAuthService],
})
export class BlueskyModule {}
