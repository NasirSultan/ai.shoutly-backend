import { Controller, Post, Body, Get, Req, Query, UseGuards } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";

@Controller("subscription")
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Post("buy")
  async buy(@Req() req, @Body() dto: CreateSubscriptionDto) {
    const userId = req.user.id;
    return this.subscriptionService.buySubscription(userId, dto);
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
}