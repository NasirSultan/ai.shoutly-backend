import { Module } from '@nestjs/common'
import { DriveDeliverController } from './drive-deliver.controller'
import { DriveDeliverService } from './drive-deliver.service'
import { PrismaService } from '../../../lib/prisma.service'

@Module({
  controllers: [DriveDeliverController],
  providers: [DriveDeliverService, PrismaService]
})
export class DriveDeliverModule {}
