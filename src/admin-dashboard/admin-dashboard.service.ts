import { Injectable } from '@nestjs/common';
import { prisma } from '../lib/prisma';

const TREND_DAYS = 30;

function last30Dates(): string[] {
  const dates: string[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function zeroFillTrend<T extends { date: string }>(rows: T[], valueKey: keyof T): { date: string; value: number }[] {
  const byDate = new Map(rows.map((r) => [r.date, Number(r[valueKey]) || 0]));
  return last30Dates().map((date) => ({ date, value: byDate.get(date) ?? 0 }));
}

@Injectable()
export class AdminDashboardService {
  private prisma = prisma;

  async getOverview() {
    const [
      totalUsers,
      newUsersLast30,
      userTrendRaw,
      activeSubs,
      trialSubs,
      expiredSubs,
      byPlan,
      aiUsageAgg,
      aiTrendRaw,
      byProvider,
      industries,
      subIndustries,
      images,
      content,
      reels,
      calendarPosts,
      totalSocialAccounts,
      byPlatform,
      recentActivity,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - TREND_DAYS * 86400000) } } }),
      this.prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as date, COUNT(*) as count
        FROM "User"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1
      `,
      this.prisma.subscription.count({ where: { isActive: true, isTrial: false } }),
      this.prisma.subscription.count({ where: { isTrial: true } }),
      this.prisma.subscription.count({ where: { isActive: false } }),
      this.prisma.subscription.groupBy({ by: ['plan'], where: { isActive: true }, _count: { _all: true } }),
      this.prisma.aiUsageLog.aggregate({
        where: { createdAt: { gte: new Date(Date.now() - TREND_DAYS * 86400000) } },
        _sum: { estimatedCostUsd: true },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<Array<{ date: string; cost: number }>>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as date, SUM("estimatedCostUsd")::float as cost
        FROM "AiUsageLog"
        WHERE "createdAt" >= NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1
      `,
      this.prisma.aiUsageLog.groupBy({
        by: ['provider'],
        where: { createdAt: { gte: new Date(Date.now() - TREND_DAYS * 86400000) } },
        _count: { _all: true },
      }),
      this.prisma.industry.count(),
      this.prisma.subIndustry.count(),
      this.prisma.image.count({ where: { deletedAt: null } }),
      this.prisma.content.count(),
      this.prisma.reel.count(),
      this.prisma.calendarPost.count(),
      this.prisma.socialAccount.count(),
      this.prisma.socialAccount.groupBy({ by: ['platform'], _count: { _all: true } }),
      this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);

    return {
      users: {
        total: totalUsers,
        newLast30Days: newUsersLast30,
        trend: zeroFillTrend(
          userTrendRaw.map((r) => ({ date: r.date, count: Number(r.count) })),
          'count',
        ),
      },
      subscriptions: {
        active: activeSubs,
        trial: trialSubs,
        expired: expiredSubs,
        byPlan: byPlan.map((p) => ({ plan: p.plan ?? 'UNKNOWN', count: p._count._all })),
      },
      aiUsage: {
        totalCallsLast30Days: aiUsageAgg._count._all,
        totalCostUsdLast30Days: aiUsageAgg._sum.estimatedCostUsd ?? 0,
        trend: zeroFillTrend(aiTrendRaw, 'cost'),
        byProvider: byProvider.map((p) => ({ provider: p.provider, calls: p._count._all })),
      },
      contentLibrary: {
        industries,
        subIndustries,
        images,
        content,
        reels,
        calendarPosts,
      },
      socialAccounts: {
        total: totalSocialAccounts,
        byPlatform: byPlatform.map((p) => ({ platform: p.platform ?? 'UNKNOWN', count: p._count._all })),
      },
      recentActivity,
    };
  }
}
