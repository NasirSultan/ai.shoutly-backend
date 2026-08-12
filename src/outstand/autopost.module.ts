import { Module } from '@nestjs/common';
import { AutopostService } from './autopost.service';
import { AutopostController } from './autopost.controller';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../common/redis/redis.module';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [AutopostController],
  providers: [AutopostService],
  exports: [AutopostService],
})
export class AutopostModule {}