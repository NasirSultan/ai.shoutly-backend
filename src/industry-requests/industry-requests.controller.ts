import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common'
import { IndustryRequestsService } from './industry-requests.service'
import { CreateIndustryRequestDto } from './dto/create-industry-request.dto'
import { UpdateIndustryRequestStatusDto } from './dto/update-industry-request-status.dto'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('industry-requests')
export class IndustryRequestsController {
  constructor(private readonly industryRequestsService: IndustryRequestsService) {}

  @Post()
  create(@Body() dto: CreateIndustryRequestDto) {
    return this.industryRequestsService.create(dto)
  }

  @Get()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findAll() {
    return this.industryRequestsService.findAll()
  }

  @Get(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findOne(@Param('id') id: string) {
    return this.industryRequestsService.findOne(id)
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  updateStatus(@Param('id') id: string, @Body() dto: UpdateIndustryRequestStatusDto) {
    return this.industryRequestsService.updateStatus(id, dto)
  }

  @Delete(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  remove(@Param('id') id: string) {
    return this.industryRequestsService.remove(id)
  }
}
