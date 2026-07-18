import { Controller, Post, Body, Get, Req, Query, Param, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { SubscriptionService } from "./subscription.service";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { toCsv } from "../common/utils/csv.util";
import { AuditLogService } from "../audit-log/audit-log.service";

@Controller("subscription")
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post("buy")
  async buy(@Req() req, @Body() dto: CreateSubscriptionDto) {
    const userId = req.user.id;
    const result = await this.subscriptionService.buySubscription(userId, dto);

    this.auditLogService.log({
      actor: { id: userId, email: req.user.email },
      action: "SUBSCRIPTION_PURCHASED",
      targetType: "Subscription",
      targetId: result?.subscription?.id ?? userId,
      after: { plan: result?.subscription?.plan, billing: result?.subscription?.billing, price: result?.price, currency: result?.currency },
    });

    return result;
  }

  @Get("current")
  async current(@Req() req) {
    const userId = req.user.id;
    return this.subscriptionService.getCurrentPlan(userId);
  }

  @Get("history")
  async history(@Req() req) {
    const userId = req.user.id;
    return this.subscriptionService.getSubscriptionHistory(userId);
  }

  @Get("admin/payments")
  @UseGuards(new RolesGuard(["SUPERADMIN"]))
  async adminPayments(
    @Query("page") page = "1",
    @Query("limit") limit = "20",
    @Query("search") search?: string,
    @Query("status") status?: "active" | "expired" | "trial",
    @Query("plan") plan?: string,
  ) {
    return this.subscriptionService.getAllPaymentsForAdmin({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 20)),
      search: search?.trim() || undefined,
      status,
      plan,
    });
  }

  @Get("admin/payments/export")
  @UseGuards(new RolesGuard(["SUPERADMIN"]))
  async exportPaymentsCsv(
    @Query("search") search: string | undefined,
    @Query("status") status: "active" | "expired" | "trial" | undefined,
    @Query("plan") plan: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.subscriptionService.getAllPaymentsForExport({
      search: search?.trim() || undefined,
      status,
      plan,
    });
    const csv = toCsv(rows, [
      { key: "transactionId", header: "Transaction ID" },
      { key: "user", header: "User Name", value: (r) => r.user?.name },
      { key: "userEmail", header: "User Email", value: (r) => r.user?.email },
      { key: "plan", header: "Plan" },
      { key: "billing", header: "Billing" },
      { key: "amount", header: "Amount" },
      { key: "currency", header: "Currency" },
      { key: "isActive", header: "Active", value: (r) => (r.isActive ? "Yes" : "No") },
      { key: "isTrial", header: "Trial", value: (r) => (r.isTrial ? "Yes" : "No") },
      { key: "startedAt", header: "Started", value: (r) => new Date(r.startedAt).toISOString() },
      { key: "expiresAt", header: "Expires", value: (r) => (r.expiresAt ? new Date(r.expiresAt).toISOString() : "") },
    ]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="payments.csv"');
    res.send(csv);
  }

  @Get("admin/payments/:userId")
  @UseGuards(new RolesGuard(["SUPERADMIN"]))
  async adminUserPaymentDetail(@Param("userId") userId: string) {
    return this.subscriptionService.getUserPaymentDetailForAdmin(userId);
  }
}