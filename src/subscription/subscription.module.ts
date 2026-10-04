import { Module } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionController } from "./subscription.controller";
import { RazorpayWebhookController } from "./razorpay-webhook.controller";
import { PaymentService } from "./payment.service";
import { AuthModule } from "../auth/auth.module";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [AuthModule, AuditLogModule],
  controllers: [SubscriptionController, RazorpayWebhookController],
  providers: [SubscriptionService, PaymentService],
  exports: [PaymentService],
})
export class SubscriptionModule {}