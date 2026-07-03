import { Controller, Post, Param, Query } from '@nestjs/common'
import { DriveDeliverService } from './drive-deliver.service'

@Controller('subindustries')
export class DriveDeliverController {
  constructor(private service: DriveDeliverService) {}

  @Post(':id/deliver-images')
  deliverBySubIndustry(@Param('id') subIndustryId: string) {
    return this.service.deliverImages(subIndustryId)
  }

  @Post('deliver-images/all')
  deliverAll() {
    return this.service.deliverImages()
  }
}
