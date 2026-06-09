import { Module } from '@nestjs/common'
import { DriveImportController } from './drive-import.controller'
import { DriveImportService } from './drive-import.service'

@Module({
  controllers: [DriveImportController],
  providers: [DriveImportService]
})
export class DriveImportModule {}