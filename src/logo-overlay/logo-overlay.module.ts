import { Module } from '@nestjs/common';
import { LogoUploadController } from './logo-upload.controller';
import { LogoUploadService } from './logo-upload.service';
import { ApplyLogoController } from './apply-logo.controller';
import { ApplyLogoService } from './apply-logo.service';
import { ImgbbService } from '../lib/imgbb/imgbb.service';
import { JwtLibModule } from '../lib/jwt/jwt.module';
import { RedisModule } from '../common/redis/redis.module';

@Module({
  imports: [JwtLibModule, RedisModule],
  controllers: [LogoUploadController, ApplyLogoController],
  providers: [LogoUploadService, ApplyLogoService, ImgbbService],
})
export class LogoOverlayModule {}
