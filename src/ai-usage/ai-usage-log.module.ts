import { Module } from '@nestjs/common';
import { AiUsageLogService } from './ai-usage-log.service';
import { AiUsageLogController } from './ai-usage-log.controller';
import { JwtLibModule } from '../lib/jwt/jwt.module';

@Module({
  imports: [JwtLibModule],
  controllers: [AiUsageLogController],
  providers: [AiUsageLogService],
  exports: [AiUsageLogService],
})
export class AiUsageLogModule {}
