import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { LinkedInController } from './linkedin.controller';
import { LinkedInService } from './linkedin.service';

@Module({
  imports: [AuthModule],
  controllers: [LinkedInController],
  providers: [LinkedInService],
  exports: [LinkedInService],
})
export class LinkedInModule {}
