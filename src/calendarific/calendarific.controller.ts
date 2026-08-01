import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { CalendarificService } from './calendarific.service'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('calendarific')
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
export class CalendarificController {
  constructor(private readonly calendarificService: CalendarificService) {}

  @Get('holidays')
  getHolidays(
    @Query('country') country: string,
    @Query('year') year: string,
    @Query('type') type?: string,
    @Query('month') month?: string,
    @Query('day') day?: string,
    @Query('location') location?: string,
  ) {
    return this.calendarificService.getHolidays({
      country,
      year: parseInt(year),
      type,
      month: month ? parseInt(month) : undefined,
      day: day ? parseInt(day) : undefined,
      location,
    })
  }

  @Get('countries')
  getCountries() {
    return this.calendarificService.getCountries()
  }
}
