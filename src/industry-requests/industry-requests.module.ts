import { Module } from '@nestjs/common'
import { IndustryRequestsController } from './industry-requests.controller'
import { IndustryRequestsService } from './industry-requests.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [IndustryRequestsController],
  providers: [IndustryRequestsService],
})
export class IndustryRequestsModule {}
