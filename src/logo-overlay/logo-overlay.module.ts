import { Module } from '@nestjs/common';
import { LogoUploadController } from './logo-upload.controller';
import { LogoUploadService } from './logo-upload.service';
import { ApplyLogoController } from './apply-logo.controller';
import { ApplyLogoService } from './apply-logo.service';
import { ImgbbService } from '../lib/imgbb/imgbb.service';

@Module({
  controllers: [LogoUploadController, ApplyLogoController],
  providers: [LogoUploadService, ApplyLogoService, ImgbbService],
})
export class LogoOverlayModule {}
