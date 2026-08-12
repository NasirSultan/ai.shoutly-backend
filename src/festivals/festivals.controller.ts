import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { FestivalsService } from './festivals.service'
import { CreateFestivalDto } from './dto/create-festival.dto'
import { UpdateFestivalDto } from './dto/update-festival.dto'
import { DriveImportService } from '../industries/subindustries/drive-import/drive-import.service'
import { FestivalType } from '@prisma/client'

@Controller('festivals')
export class FestivalsController {
  constructor(
    private readonly festivalsService: FestivalsService,
    private readonly driveImportService: DriveImportService,
  ) {}

  @Post()
  create(@Body() dto: CreateFestivalDto) {
    return this.festivalsService.create(dto)
  }

  @Post('bulk')
  bulkCreate(@Body() items: CreateFestivalDto[]) {
    return this.festivalsService.bulkCreate(items)
  }

  @Get()
  findAll(
    @Query('page') page = '1',
    @Query('limit') limit = '6',
    @Query('type') type?: FestivalType,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('search') search?: string,
    @Query('upcoming') upcoming?: string,
    @Query('country') country?: string,
    @Query('withImages') withImages?: string,
  ) {
    return this.festivalsService.findAll({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 6)),
      type,
      month: month ? parseInt(month) : undefined,
      year: year ? parseInt(year) : undefined,
      search: search?.trim() || undefined,
      upcoming: upcoming === 'true',
      country: country?.trim() || undefined,
      withImages: withImages !== 'false',
    })
  }

  @Get('random')
  findRandom() {
    return this.festivalsService.findRandomWithImages()
  }

  @Get('today')
  findToday() {
    return this.festivalsService.findToday()
  }

  @Get('upcoming')
  findUpcoming() {
    return this.festivalsService.findUpcoming()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.festivalsService.findOne(id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFestivalDto) {
    return this.festivalsService.update(id, dto)
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.festivalsService.remove(id)
  }

  @Post(':id/import-images')
  importImages(
    @Param('id') festivalId: string,
    @Body('folderId') folderId: string,
  ) {
    return this.driveImportService.importForFestival(festivalId, folderId)
  }

  @Get(':id/images')
  getImages(@Param('id') festivalId: string) {
    return this.festivalsService.getImages(festivalId)
  }
}
