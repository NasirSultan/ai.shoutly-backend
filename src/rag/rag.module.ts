import { Module } from '@nestjs/common'
import { RagService } from './rag.service'
import { RagController } from './rag.controller'
import { PrismaService } from '../lib/prisma.service'
import { AuthModule } from '../auth/auth.module'
import { AiUsageLogModule } from '../ai-usage/ai-usage-log.module'

@Module({
  imports: [AuthModule, AiUsageLogModule],
  providers: [RagService, PrismaService],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
