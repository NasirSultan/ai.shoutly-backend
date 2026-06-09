import { Controller, Post, Body, Param } from '@nestjs/common'
import { DriveImportService } from './drive-import.service'

@Controller('subindustries')
export class DriveImportController {
  constructor(private service: DriveImportService) {}
  
  @Post(':id/import-drive')
  importFromDrive(
    @Param('id') subIndustryId: string,
    @Body('folderId') folderId: string
  ) {
    return this.service.importFromDrive(subIndustryId, folderId)
  }
}