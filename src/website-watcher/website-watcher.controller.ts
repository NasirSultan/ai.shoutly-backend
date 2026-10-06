import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common'
import { WebsiteWatcherService } from './website-watcher.service'
import { CheckWebsiteDto } from './dto/check-website.dto'
import { SetWatcherWebsiteDto } from './dto/set-watcher-website.dto'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('website-watcher')
@UseGuards(AuthGuard)
export class WebsiteWatcherController {
  constructor(private readonly websiteWatcherService: WebsiteWatcherService) {}

  // The signed-in user's website, checks left today and last saved result.
  @Get('me')
  getStatus(@Req() req) {
    return this.websiteWatcherService.getStatus(req.user)
  }

  @Post('check')
  checkForChanges(@Req() req, @Body(new ValidationPipe({ whitelist: true })) dto: CheckWebsiteDto) {
    return this.websiteWatcherService.checkForChanges(req.user, dto.url)
  }

  @Patch('users/:userId/website')
  @UseGuards(new RolesGuard(['SUPERADMIN']))
  setUserWebsite(
    @Param('userId') userId: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: SetWatcherWebsiteDto,
  ) {
    return this.websiteWatcherService.setUserWebsite(userId, dto.website)
  }
}
