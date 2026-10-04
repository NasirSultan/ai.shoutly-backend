import { Module } from '@nestjs/common';
import { LogoUploadController } from './logo-upload.controller';
import { LogoUploadService } from './logo-upload.service';
import { TemplateUploadController } from './template-upload.controller';
import { TemplateUploadService } from './template-upload.service';
import { ApplyLogoController } from './apply-logo.controller';
import { ApplyLogoService } from './apply-logo.service';
import { ImgbbService } from '../lib/imgbb/imgbb.service';
import { JwtLibModule } from '../lib/jwt/jwt.module';
import { RedisModule } from '../common/redis/redis.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TemplatePaymentService } from './template-payment.service';

@Module({
  imports: [JwtLibModule, RedisModule, SubscriptionModule],
  controllers: [LogoUploadController, TemplateUploadController, ApplyLogoController],
  providers: [LogoUploadService, TemplateUploadService, ApplyLogoService, TemplatePaymentService, ImgbbService],
})
export class LogoOverlayModule {}
