import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { RedisModule } from '../../common/redis/redis.module';
import { XController } from './x.controller';
import { XService } from './x.service';

@Module({
  imports: [AuthModule, RedisModule],
  controllers: [XController],
  providers: [XService],
  exports: [XService],
})
export class XModule {}
