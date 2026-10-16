import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { GoogleBusinessController } from './google-business.controller';
import { GoogleBusinessService } from './google-business.service';

@Module({
  imports: [AuthModule],
  controllers: [GoogleBusinessController],
  providers: [GoogleBusinessService],
  exports: [GoogleBusinessService],
})
export class GoogleBusinessModule {}
