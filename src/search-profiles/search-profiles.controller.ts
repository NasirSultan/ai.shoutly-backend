import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common'
import { AuthGuard } from '../common/guards/auth.guard'
import { SearchProfilesService } from './search-profiles.service'
import { CreateSearchProfileDto, UpdateSearchProfileDto } from './dto/search-profile.dto'

// Lead Finder search profiles. The user always comes from the token (AuthGuard),
// so users can only see and change their own profiles.
@Controller('search-profiles')
@UseGuards(AuthGuard)
export class SearchProfilesController {
  constructor(private readonly searchProfilesService: SearchProfilesService) {}

  // Suggested keywords, subreddits and exclusions from the user's Website Analysis.
  // Declared before ':id' so "suggestions" isn't read as a profile id.
  @Get('suggestions')
  suggestions(@Req() req) {
    return this.searchProfilesService.getSuggestions(req.user)
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
  update(
    @Req() req,
    @Param('id') id: string,
    @Body(new ValidationPipe({ whitelist: true })) dto: UpdateSearchProfileDto,
  ) {
    return this.searchProfilesService.update(req.user, id, dto)
  }

  @Delete(':id')
  remove(@Req() req, @Param('id') id: string) {
    return this.searchProfilesService.remove(req.user, id)
  }
}
