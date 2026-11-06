import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RedisModule } from '../../common/redis/redis.module';
import { TiktokController } from './tiktok.controller';
import { TiktokService } from './tiktok.service';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [TiktokController],
  providers: [TiktokService],
  exports: [TiktokService],
})
export class TiktokModule {}
