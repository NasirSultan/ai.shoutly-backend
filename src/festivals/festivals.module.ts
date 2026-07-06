import { Module } from '@nestjs/common'
import { FestivalsController } from './festivals.controller'
import { FestivalsService } from './festivals.service'
import { DriveImportModule } from '../industries/subindustries/drive-import/drive-import.module'

@Module({
  imports: [DriveImportModule],
  controllers: [FestivalsController],
  providers: [FestivalsService],
})
export class FestivalsModule {}
