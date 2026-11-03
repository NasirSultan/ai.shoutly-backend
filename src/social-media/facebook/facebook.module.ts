import { Module } from '@nestjs/common';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';
import { AuthModule } from '../../auth/auth.module';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [FacebookController],
  providers: [FacebookService],
  exports: [FacebookService],
})
export class FacebookModule {}
