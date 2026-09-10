import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { createHmac } from 'crypto';
import { AutopostService } from './autopost.service';

class FakeRedis {
  values = new Map<string, string>();

  client = {
    get: jest.fn(async (key: string) => this.values.get(key) ?? null),
    getDel: jest.fn(async (key: string) => {
      const value = this.values.get(key) ?? null;
      this.values.delete(key);
      return value;
    }),
    set: jest.fn(async (key: string, value: string, options?: { NX?: boolean }) => {
      if (options?.NX && this.values.has(key)) return null;
      this.values.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (this.values.delete(key) ? 1 : 0)),
  };

  getClient() {
    return this.client;
  }
}

describe('AutopostService ownership and analytics', () => {
  let redis: FakeRedis;
  let service: AutopostService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new AutopostService(redis as any);
    jest.restoreAllMocks();
  });

  it('rejects linking an Outstand account owned by another user', async () => {
    (service as any).prisma = {
      socialAccount: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'user-a' }),
      },
    };

    await expect(
      (service as any).assertAccountMayBeLinked('user-b', 'account-1', []),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a connection state stolen by another authenticated user', async () => {
    redis.values.set(
      'outstand:connection:state-1',
      JSON.stringify({
        userId: 'user-a',
        platform: 'instagram',
        redirectUri: 'https://shoutlyai.com/dashboards/settings/accounts',
        baselineAccountIds: [],
      }),
    );

    await expect(
      (service as any).readConnection('state-1', 'user-b'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects replayed signed webhook deliveries', async () => {
    process.env.OUTSTAND_WEBHOOK_SECRET = 'test-secret';
    const body = Buffer.from(JSON.stringify({ event: 'post.published', data: { id: 'post-1' } }));
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(body).digest('hex')}`;

    await service.verifyWebhookSignature(body, signature);
    await expect(service.verifyWebhookSignature(body, signature)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('scopes analytics to the user query and sums multiple accounts per platform', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      { id: 'local-1', outstandAccountId: 'out-1', platform: 'INSTAGRAM', username: 'one', avatarUrl: null },
      { id: 'local-2', outstandAccountId: 'out-2', platform: 'INSTAGRAM', username: 'two', avatarUrl: null },
    ]);
    const countPosts = jest.fn().mockResolvedValue(0);
    (service as any).prisma = {
      $queryRaw: queryRaw,
      post: { count: countPosts },
    };
    jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: { data: { followers_count: 10, posts_count: 2, engagement: { reach: 100, views: 120, total_interactions: 8 } } },
      } as any)
      .mockResolvedValueOnce({
        data: { data: { followers_count: 20, posts_count: 3, engagement: { reach: 200, views: 240, total_interactions: 12 } } },
      } as any);

    const result = await service.calculateUserDashboardMetricsV2(
      'user-a',
      '7d',
      undefined,
      'INSTAGRAM',
    );

    expect(queryRaw.mock.calls[0][1]).toBe('user-a');
    expect(countPosts).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: 'user-a',
        deliveries: {
          some: {
            socialAccount: {
              platform: 'INSTAGRAM',
            },
          },
        },
      }),
    });
    expect(result.accounts).toHaveLength(2);
    expect(result.platforms.INSTAGRAM.accountCount).toBe(2);
    expect(result.metrics.totalFollowers).toBe(30);
    expect(result.metrics.totalReach).toBe(300);
    expect(result.metrics.totalEngagement).toBe(20);
    expect(result.timeseriesAvailable).toBe(false);
  });

  it('parses Facebook fields and reports an account failure as partial data', async () => {
    (service as any).prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'fb-local', outstandAccountId: 'fb-out', platform: 'FACEBOOK', username: 'page', avatarUrl: null },
        { id: 'ig-local', outstandAccountId: 'ig-out', platform: 'INSTAGRAM', username: 'broken', avatarUrl: null },
      ]),
      post: { count: jest.fn().mockResolvedValue(0) },
    };
    jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({
        data: {
          data: {
            followers_count: 50,
            engagement: { impressions: 900, reach: 700, post_engagements: 45 },
          },
        },
      } as any)
      .mockRejectedValueOnce(new Error('upstream unavailable'));

    const result = await service.calculateUserDashboardMetricsV2('user-a', '30d');

    expect(result.metrics.totalImpressions).toBe(900);
    expect(result.metrics.totalReach).toBe(700);
    expect(result.metrics.totalEngagement).toBe(45);
    expect(result.partialData).toBe(true);
    expect(result.accounts.find((account) => account.id === 'ig-local')?.status).toBe('error');
  });

  it('preserves the committed legacy analytics response and synthetic chart behavior', async () => {
    (service as any).prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { outstandAccountId: 'legacy-out', platform: 'FACEBOOK', username: 'legacy-page' },
      ]),
      post: { count: jest.fn().mockResolvedValue(1) },
    };
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      data: {
        data: {
          followers_count: 50,
          engagement: { reach: 70, likes: 14, comments: 2, shares: 2, saves: 0 },
        },
      },
    } as any);

    const result = await service.calculateUserDashboardMetrics(
      'user-a',
      '2026-09-01',
      '2026-09-02',
    );

    expect(result.metrics).toEqual({
      totalFollowers: 50,
      totalReach: 70,
      totalEngagement: 18,
      avgEngagementRate: 25.71,
      postsThisMonth: 1,
    });
    expect(result.charts.engagementOverTime).toHaveLength(2);
    expect(result.charts.reachAndImpressions[0]).toMatchObject({
      reach: 35,
      impressions: 42,
    });
    expect(result.charts.followerGrowth).toHaveLength(2);
    expect(result.charts.followerGrowth[0]).toMatchObject({
      FACEBOOK: 1,
      total: 1,
    });
  });

  describe('getPendingConnection tenant handling', () => {
    const userId = 'user-a';
    const state = 'state-fb-1';
    const sessionToken = 'session-token-1';
    const pages = [{ id: 'page-1', name: 'Page One' }];

    function seedFacebookConnection(ownerId = userId) {
      redis.values.set(
        'outstand:connection:state-fb-1',
        JSON.stringify({
          userId: ownerId,
          platform: 'facebook',
          redirectUri: 'https://shoutlyai.com/dashboards/settings/accounts',
          baselineAccountIds: [],
        }),
      );
    }

    function mockPendingFetch(body: Record<string, unknown>) {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => body,
      });
      (global as any).fetch = fetchMock;
      return fetchMock;
    }

    it('succeeds when pending omits tenant_id and Redis state belongs to the user', async () => {
      seedFacebookConnection();
      mockPendingFetch({ data: { available_pages: pages } });

      const result = await service.getPendingConnection(userId, sessionToken, state);

      expect(result).toEqual({ success: true, availablePages: pages });
      expect(redis.client.set).toHaveBeenCalled();
    });

    it('rejects when pending returns a tenant_id for a different user', async () => {
      seedFacebookConnection();
      mockPendingFetch({
        data: { tenant_id: 'other-user', availablePages: pages },
      });

      await expect(
        service.getPendingConnection(userId, sessionToken, state),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('still rejects Redis state owned by another user (cross-user check intact)', async () => {
      seedFacebookConnection('user-b');
      mockPendingFetch({ data: { availablePages: pages } });

      await expect(
        service.getPendingConnection(userId, sessionToken, state),
      ).rejects.toThrow('Connection state does not belong to this user.');
    });
  });
});
