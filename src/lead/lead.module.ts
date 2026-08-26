import { Module } from '@nestjs/common'
import { LeadController } from './lead.controller'
import { LeadService } from './lead.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [LeadController],
  providers: [LeadService],
})
export class LeadModule {}
