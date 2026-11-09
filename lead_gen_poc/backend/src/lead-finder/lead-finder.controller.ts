import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common'
import { DemoUserGuard } from '../common/guards/demo-user.guard'
import { LeadFinderService } from './lead-finder.service'
import { FetchLeadsDto } from './dto/fetch-leads.dto'
import { ListLeadsDto } from './dto/list-leads.dto'
import { UpdateLeadDto } from './dto/update-lead.dto'

// In ai.shoutly-backend: replace DemoUserGuard with AuthGuard.
@Controller('lead-finder')
@UseGuards(DemoUserGuard)
export class LeadFinderController {
  constructor(private readonly leadFinderService: LeadFinderService) {}

  // "Get leads" for one search profile. Cache hit: ready now. Miss: returns job ids to poll.
  @Post('fetch')
  fetch(@Req() req, @Body(new ValidationPipe({ whitelist: true })) dto: FetchLeadsDto) {
    return this.leadFinderService.requestLeads(req.user, dto.profileId)
  }

  @Get('fetch/:jobId')
  fetchStatus(@Req() req, @Param('jobId') jobId: string, @Query('profileId') profileId: string) {
    return this.leadFinderService.getFetchStatus(req.user, jobId, profileId)
  }

  @Get('leads')
  list(@Req() req, @Query(new ValidationPipe({ whitelist: true, transform: true })) query: ListLeadsDto) {
    return this.leadFinderService.listLeads(req.user, query)
  }

  @Patch('leads/:id')
  update(@Req() req, @Param('id') id: string, @Body(new ValidationPipe({ whitelist: true })) dto: UpdateLeadDto) {
    return this.leadFinderService.updateLead(req.user, id, dto)
  }
}
