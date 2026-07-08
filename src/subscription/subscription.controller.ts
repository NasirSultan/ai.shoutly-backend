import { Controller, Post, Body, Get, Req, UseGuards } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { AuthGuard } from "../common/guards/auth.guard";

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
}