import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common'
import { BookDemoService } from './book-demo.service'
import { CreateBookDemoDto } from './dto/create-book-demo.dto'
import { UpdateBookDemoStatusDto } from './dto/update-book-demo-status.dto'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('book-demo')
export class BookDemoController {
  constructor(private readonly bookDemoService: BookDemoService) {}

  @Get('slots')
  getAvailableSlots(@Query('week') week?: string) {
    return this.bookDemoService.getAvailableSlots(week)
  }

  @Post()
  create(@Body() dto: CreateBookDemoDto) {
    return this.bookDemoService.create(dto)
  }

  @Get()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findAll() {
    return this.bookDemoService.findAll()
  }

  @Get('admin/week')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  getWeekBookings(
    @Query('week') week?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.bookDemoService.getWeekBookings(
      week,
      Math.max(1, parseInt(page) || 1),
      Math.min(100, Math.max(1, parseInt(limit) || 20)),
    )
  }

  @Get(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findOne(@Param('id') id: string) {
    return this.bookDemoService.findOne(id)
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  updateStatus(@Param('id') id: string, @Body() dto: UpdateBookDemoStatusDto) {
    return this.bookDemoService.updateStatus(id, dto)
  }

  @Patch(':id/accept')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  accept(@Param('id') id: string) {
    return this.bookDemoService.accept(id)
  }

  @Patch(':id/reject')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  reject(@Param('id') id: string) {
    return this.bookDemoService.reject(id)
  }

  @Delete(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  remove(@Param('id') id: string) {
    return this.bookDemoService.remove(id)
  }
}
