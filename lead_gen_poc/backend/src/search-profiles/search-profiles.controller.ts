import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common'
import { DemoUserGuard } from '../common/guards/demo-user.guard'
import { SearchProfilesService } from './search-profiles.service'
import { CrawlWebsiteDto } from './dto/crawl-website.dto'
import { CreateSearchProfileDto, UpdateSearchProfileDto } from './dto/search-profile.dto'

// In ai.shoutly-backend: replace DemoUserGuard with AuthGuard.
@Controller('search-profiles')
@UseGuards(DemoUserGuard)
export class SearchProfilesController {
  constructor(private readonly searchProfilesService: SearchProfilesService) {}

  // Website analysis (mocked in the POC): returns a job id to poll.
  @Post('crawl')
  crawl(@Req() req, @Body(new ValidationPipe({ whitelist: true })) dto: CrawlWebsiteDto) {
    return this.searchProfilesService.startCrawl(req.user, dto.url)
  }

  @Get('crawl/:jobId')
  crawlStatus(@Req() req, @Param('jobId') jobId: string) {
    return this.searchProfilesService.getCrawl(req.user, jobId)
  }

  @Post()
  create(@Req() req, @Body(new ValidationPipe({ whitelist: true })) dto: CreateSearchProfileDto) {
    return this.searchProfilesService.create(req.user, dto)
  }

  @Get()
  list(@Req() req) {
    return this.searchProfilesService.list(req.user)
  }

  @Get(':id')
  get(@Req() req, @Param('id') id: string) {
    return this.searchProfilesService.get(req.user, id)
  }

  @Patch(':id')
  update(@Req() req, @Param('id') id: string, @Body(new ValidationPipe({ whitelist: true })) dto: UpdateSearchProfileDto) {
    return this.searchProfilesService.update(req.user, id, dto)
  }

  @Delete(':id')
  remove(@Req() req, @Param('id') id: string) {
    return this.searchProfilesService.remove(req.user, id)
  }
}
