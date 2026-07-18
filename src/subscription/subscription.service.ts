import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { PlanPrices, Plan, Billing, Currency } from "./subscription.constants";
import { CreateSubscriptionDto } from "./dto/create-subscription.dto";
import { prisma } from "../lib/prisma";
import { CSV_EXPORT_ROW_LIMIT } from "../common/utils/csv.util";

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

  async getAllPaymentsForAdmin(opts: {
    page: number;
    limit: number;
    search?: string;
    status?: "active" | "expired" | "trial";
    plan?: string;
  }) {
    const { page, limit, search, status, plan } = opts;
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {};
    if (search) {
      where.user = {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      };
    }
    if (status === "active") where.isActive = true;
    if (status === "expired") where.isActive = false;
    if (status === "trial") where.isTrial = true;
    if (plan) where.plan = plan;

    const [filteredTotal, rows, grandTotal, activeCount, trialCount, revenueAgg] =
      await Promise.all([
        prisma.subscription.count({ where }),
        prisma.subscription.findMany({
          where,
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.subscription.count(),
        prisma.subscription.count({ where: { isActive: true } }),
        prisma.subscription.count({ where: { isTrial: true } }),
        prisma.subscription.aggregate({
          where: { isTrial: false },
          _sum: { amount: true },
        }),
      ]);

    return {
      summary: {
        totalTransactions: grandTotal,
        activeSubscriptions: activeCount,
        trialSubscriptions: trialCount,
        totalRevenue: revenueAgg._sum.amount ?? 0,
      },
      data: rows.map((r) => ({
        transactionId: r.id,
        user: r.user,
        plan: r.plan,
        billing: r.billing,
        amount: r.amount,
        currency: r.currency,
        isActive: r.isActive,
        isTrial: r.isTrial,
        startedAt: r.startedAt,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
      meta: {
        total: filteredTotal,
        page,
        limit,
        totalPages: Math.ceil(filteredTotal / limit) || 1,
      },
    };
  }

  async getAllPaymentsForExport(opts: {
    search?: string;
    status?: "active" | "expired" | "trial";
    plan?: string;
  }) {
    const { search, status, plan } = opts;

    const where: Record<string, any> = {};
    if (search) {
      where.user = {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
        ],
      };
    }
    if (status === "active") where.isActive = true;
    if (status === "expired") where.isActive = false;
    if (status === "trial") where.isTrial = true;
    if (plan) where.plan = plan;

    const rows = await prisma.subscription.findMany({
      where,
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: CSV_EXPORT_ROW_LIMIT,
    });

    return rows.map((r) => ({
      transactionId: r.id,
      user: r.user,
      plan: r.plan,
      billing: r.billing,
      amount: r.amount,
      currency: r.currency,
      isActive: r.isActive,
      isTrial: r.isTrial,
      startedAt: r.startedAt,
      expiresAt: r.expiresAt,
    }));
  }

  async getUserPaymentDetailForAdmin(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        brandName: true,
        createdAt: true,
        industry: { select: { name: true } },
        subIndustry: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException(`User ${userId} not found`);

    const [subscriptions, revenueAgg] = await Promise.all([
      prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.subscription.aggregate({
        where: { userId, isTrial: false },
        _sum: { amount: true },
      }),
    ]);

    const activeSubscription = subscriptions.find((s) => s.isActive) ?? null;

    return {
      user,
      summary: {
        totalTransactions: subscriptions.length,
        totalSpent: revenueAgg._sum.amount ?? 0,
        hasActivePlan: !!activeSubscription,
        currentPlan: activeSubscription
          ? {
              plan: activeSubscription.plan,
              billing: activeSubscription.billing,
              amount: activeSubscription.amount,
              currency: activeSubscription.currency,
              isTrial: activeSubscription.isTrial,
              startedAt: activeSubscription.startedAt,
              expiresAt: activeSubscription.expiresAt,
            }
          : null,
      },
      transactions: subscriptions.map((s) => ({
        transactionId: s.id,
        plan: s.plan,
        billing: s.billing,
        amount: s.amount,
        currency: s.currency,
        isActive: s.isActive,
        isTrial: s.isTrial,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        createdAt: s.createdAt,
      })),
    };
  }
}
