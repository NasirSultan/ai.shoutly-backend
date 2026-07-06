import { Injectable } from "@nestjs/common";
import {  PlanPrices, Plan, Billing } from "./subscription.constants";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { prisma } from "../lib/prisma";

@Injectable()
export class SubscriptionService {
  async buySubscription(userId: string, dto: CreateSubscriptionDto, trial = false) {
    const { plan, billing } = dto;

    if (trial) {
      const previousTrial = await prisma.subscription.findFirst({
        where: { userId, isTrial: true },
      });
      if (previousTrial) {
        throw new Error("User has already used the free trial");
      }
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
    const expiresAt = trial
      ? new Date(now.setDate(now.getDate() + 7))
      : billing === Billing.MONTHLY
      ? new Date(now.setMonth(now.getMonth() + 1))
      : new Date(now.setFullYear(now.getFullYear() + 1));

    const newSub = await prisma.subscription.create({
      data: {
        userId,
        plan,
        billing,
        startedAt: new Date(),
        expiresAt,
        isActive: true,
        isTrial: trial,
      },
    });

    const price = trial ? 0 : PlanPrices[plan][billing];

    return { subscription: newSub, price };
  }

  async getSubscriptionHistory(userId: string) {
    return prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  getPrice(plan: Plan, billing: Billing) {
    return PlanPrices[plan][billing];
  }
}