import { Module } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionController } from "./subscription.controller";
import { AuthModule } from "../auth/auth.module";
import { AuditLogModule } from "../audit-log/audit-log.module";

@Module({
  imports: [AuthModule, AuditLogModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
})
export class SubscriptionModule {}