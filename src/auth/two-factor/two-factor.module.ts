import { Module } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorController } from './two-factor.controller';
import { JwtLibModule } from '../../lib/jwt/jwt.module';

@Module({
  imports: [JwtLibModule],
  controllers: [TwoFactorController],
  providers: [TwoFactorService],
  exports: [TwoFactorService],
})
export class TwoFactorModule {}
