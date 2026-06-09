import { Module } from '@nestjs/common';
import { AutopostService } from './autopost.service';
import { AutopostController } from './autopost.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AutopostController],
  providers: [AutopostService],
  exports: [AutopostService],
})
export class AutopostModule {}
