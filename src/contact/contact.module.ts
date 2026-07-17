import { Module } from '@nestjs/common'
import { ContactController } from './contact.controller'
import { ContactService } from './contact.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
