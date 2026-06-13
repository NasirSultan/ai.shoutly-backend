import { Module } from '@nestjs/common'
import { RagService } from './rag.service'
import { RagController } from './rag.controller'
import { PrismaService } from '../lib/prisma.service'

@Module({
  providers: [RagService, PrismaService],
  controllers: [RagController],
  exports: [RagService],
})
export class RagModule {}
