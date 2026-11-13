import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards, ValidationPipe } from '@nestjs/common'
import { WebsiteWatcherService } from './website-watcher.service'
import { CheckWebsiteDto } from './dto/check-website.dto'
import { DescribeBusinessDto } from './dto/describe-business.dto'
import { UpdateKeywordsDto } from './dto/update-keywords.dto'
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

  // Same analysis as /check, from a description the user types instead of a
  // website. Shares the daily limit with /check.
  @Post('describe')
  describeBusiness(@Req() req, @Body(new ValidationPipe({ whitelist: true })) dto: DescribeBusinessDto) {
    return this.websiteWatcherService.describeBusiness(req.user, dto.description)
  }

  // Replaces the signed-in user's own keyword list. The user comes from the
  // token (AuthGuard), never from the request, so users can only edit their own.
  @Put('keywords')
  updateKeywords(@Req() req, @Body(new ValidationPipe({ whitelist: true })) dto: UpdateKeywordsDto) {
    return this.websiteWatcherService.updateKeywords(req.user, dto.keywords)
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
