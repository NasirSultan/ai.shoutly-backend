import { Module } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { DashboardController } from './dashboard.controller'
import { AuthModule } from '../auth/auth.module'
import { AutopostModule } from '../outstand/autopost.module'
import { NotesModule } from '../notes/notes.module'

@Module({
  imports: [AuthModule, AutopostModule, NotesModule],
  providers: [DashboardService],
  controllers: [DashboardController]
})
export class DashboardModule {}
