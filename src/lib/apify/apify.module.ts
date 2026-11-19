import { Module } from '@nestjs/common'
import { ApifyService } from './apify.service'

@Module({
  providers: [ApifyService],
  exports: [ApifyService],
})
export class ApifyModule {}
