import { Module } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { AuthModule } from "../auth/auth.module";
import { ImgbbService } from '../lib/imgbb/imgbb.service'
import { JobsModule } from '../jobs/jobs.module'
@Module({
  imports: [AuthModule, JobsModule],
  providers: [CalendarService,ImgbbService],
  controllers: [CalendarController],
})
export class CalendarModule {}