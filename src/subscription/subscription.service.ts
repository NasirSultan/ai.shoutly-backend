import { Injectable, BadRequestException } from "@nestjs/common";
import { PlanPrices, Plan, Billing, Currency } from "./subscription.constants";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { prisma } from "../lib/prisma";

@Injectable()
export class SubscriptionService {
  async buySubscription(userId: string, dto: CreateSubscriptionDto) {
    const { billing, currency } = dto;

    if (!Object.values(Billing).includes(billing)) {
      throw new BadRequestException(`Invalid billing cycle: ${billing}`);
    }
    if (!Object.values(Currency).includes(currency)) {
      throw new BadRequestException(`Invalid currency: ${currency}`);
    }

    const activeSub = await prisma.subscription.findFirst({
      where: { userId, isActive: true },
    });
    if (activeSub) {
      await prisma.subscription.update({
        where: { id: activeSub.id },
        data: { isActive: false },
      });
    }

    const now = new Date();
    const expiresAt =
      billing === Billing.MONTHLY
        ? new Date(now.setMonth(now.getMonth() + 1))
        : new Date(now.setFullYear(now.getFullYear() + 1));

    const amount = PlanPrices[currency][billing];

    const newSub = await prisma.subscription.create({
      data: {
        userId,
        plan: Plan.FULL_POWER as any,
        billing: billing as any,
        currency: currency as any,
        amount,
        startedAt: new Date(),
        expiresAt,
        isActive: true,
        isTrial: false,
      },
    });

    return { subscription: newSub, price: amount, currency };
  }

  async getCurrentPlan(userId: string) {
    const subscription = await prisma.subscription.findFirst({
      where: { userId, isActive: true },
    });

    if (!subscription) {
      return { hasActivePlan: false };
    }

    const now = Date.now();
    const daysRemaining = subscription.expiresAt
      ? Math.max(0, Math.ceil((subscription.expiresAt.getTime() - now) / (1000 * 60 * 60 * 24)))
      : null;

    return {
      hasActivePlan: true,
      isTrial: subscription.isTrial,
      billing: subscription.billing,
      currency: subscription.currency,
      amount: subscription.amount,
      startedAt: subscription.startedAt,
      expiresAt: subscription.expiresAt,
      daysRemaining,
    };
  }

  async getSubscriptionHistory(userId: string) {
    return prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  getPrice(billing: Billing, currency: Currency) {
    return PlanPrices[currency][billing];
  }
}
