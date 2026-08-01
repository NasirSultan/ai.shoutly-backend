import { Module } from '@nestjs/common'
import { CalendarificController } from './calendarific.controller'
import { CalendarificService } from './calendarific.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [CalendarificController],
  providers: [CalendarificService],
  exports: [CalendarificService],
})
export class CalendarificModule {}
