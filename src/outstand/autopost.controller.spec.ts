import { AutopostController } from './autopost.controller';
import { PATH_METADATA } from '@nestjs/common/constants';

describe('AutopostController analytics routes', () => {
  const legacyResponse = { success: true, legacy: true };
  const v2Response = { success: true, timeseriesAvailable: false };
  const service = {
    calculateUserDashboardMetrics: jest.fn().mockResolvedValue(legacyResponse),
    calculateUserDashboardMetricsV2: jest.fn().mockResolvedValue(v2Response),
  };
  const controller = new AutopostController(service as any);
  const req = { user: { id: 'user-a' } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes distinct legacy and v2 route paths', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        AutopostController.prototype.getDashboardAnalytics,
      ),
    ).toBe('analytics');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        AutopostController.prototype.getDashboardAnalyticsV2,
      ),
    ).toBe('analytics/v2');
  });

  it('forwards the legacy route only to the committed implementation', async () => {
    await expect(
      controller.getDashboardAnalytics(req, '7d', '2026-09-09'),
    ).resolves.toBe(legacyResponse);

    expect(service.calculateUserDashboardMetrics).toHaveBeenCalledWith(
      'user-a',
      '7d',
      '2026-09-09',
    );
    expect(service.calculateUserDashboardMetricsV2).not.toHaveBeenCalled();
  });

  it('forwards the v2 route only to the real implementation', async () => {
    await expect(
      controller.getDashboardAnalyticsV2(req, '30d', undefined, 'INSTAGRAM'),
    ).resolves.toBe(v2Response);

    expect(service.calculateUserDashboardMetricsV2).toHaveBeenCalledWith(
      'user-a',
      '30d',
      undefined,
      'INSTAGRAM',
    );
    expect(service.calculateUserDashboardMetrics).not.toHaveBeenCalled();
  });
});
