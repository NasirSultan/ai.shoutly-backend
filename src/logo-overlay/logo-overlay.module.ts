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
import { BrevoModule } from '../brevo/brevo.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TemplatePaymentService } from './template-payment.service';
import { TemplateCreditController } from './template-credit.controller';
import { TemplateCreditService } from './template-credit.service';

@Module({
  imports: [JwtLibModule, RedisModule, SubscriptionModule, BrevoModule, AuditLogModule],
  controllers: [LogoUploadController, TemplateUploadController, ApplyLogoController, TemplateCreditController],
  providers: [
    LogoUploadService,
    TemplateUploadService,
    ApplyLogoService,
    TemplatePaymentService,
    TemplateCreditService,
    ImgbbService,
  ],
})
export class LogoOverlayModule {}
