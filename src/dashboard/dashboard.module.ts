import { Module } from '@nestjs/common'
import { DashboardService } from './dashboard.service'
import { DashboardController } from './dashboard.controller'
import { AuthModule } from '../auth/auth.module'
import { NotesModule } from '../notes/notes.module'

@Module({
  imports: [AuthModule, NotesModule],
  providers: [DashboardService],
  controllers: [DashboardController]
})
export class DashboardModule {}
