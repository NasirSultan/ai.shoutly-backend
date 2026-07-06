import { Module } from '@nestjs/common'
import { DriveImportController } from './drive-import.controller'
import { DriveImportService } from './drive-import.service'
import { PrismaService } from '../../../lib/prisma.service'

@Module({
  controllers: [DriveImportController],
  providers: [DriveImportService, PrismaService],
  exports: [DriveImportService],
})
export class DriveImportModule {}