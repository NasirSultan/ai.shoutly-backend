import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { LeadService } from './lead.service'
import { CreateLeadDto } from './dto/create-lead.dto'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('lead')
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Post()
  create(@Body() dto: CreateLeadDto) {
    return this.leadService.create(dto)
  }

  @Get()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('search') search?: string,
  ) {
    return this.leadService.findAll({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      search,
    })
  }

  @Get(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findOne(@Param('id') id: string) {
    return this.leadService.findOne(id)
  }

  @Patch(':id/toggle-status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  toggleStatus(@Param('id') id: string) {
    return this.leadService.toggleStatus(id)
  }

  @Delete(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  remove(@Param('id') id: string) {
    return this.leadService.remove(id)
  }
}
