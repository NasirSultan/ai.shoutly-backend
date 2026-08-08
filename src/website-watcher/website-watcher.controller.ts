import { Body, Controller, Post, ValidationPipe } from '@nestjs/common'
import { WebsiteWatcherService } from './website-watcher.service'
import { CheckWebsiteDto } from './dto/check-website.dto'

@Controller('website-watcher')
export class WebsiteWatcherController {
  constructor(private readonly websiteWatcherService: WebsiteWatcherService) {}

  @Post('check')
  checkForChanges(@Body(ValidationPipe) dto: CheckWebsiteDto) {
    return this.websiteWatcherService.checkForChanges(dto.url)
  }
}
