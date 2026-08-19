import request from 'supertest';
import { createAdminHttpApp } from '../../../src/transport/http/server';
import type { ICacheService } from '../../../src/domain/interfaces/services';
import { ADMIN_SESSION_COOKIE, createAdminSession } from '../../../src/transport/http/middleware/adminAuth';

function createFakeCache(): ICacheService {
  const store = new Map<string, { value: unknown; expiresAt: number | null }>();
  return {
    async get<T>(key: string): Promise<T | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      store.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async exists(key: string): Promise<boolean> {
      return store.has(key);
    },
    async acquireLock(): Promise<boolean> {
      return true;
    },
    async releaseLock(): Promise<void> {},
    async ping(): Promise<boolean> {
      return true;
    },
  };
}

describe('admin referral routes', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };

  const statsResult = { totalReferred: 10, totalConverted: 4, totalDaysGranted: 80, totalPendingDays: 12 };
  const topResult = [
    { referrerUserId: 'u1', userLabel: '@alice', invitedCount: 5, convertedCount: 2, totalDaysGranted: 20 },
  ];
  const rewardsResult = {
    items: [
      {
        id: 'r1',
        referrerUserId: 'u1',
        referrerLabel: '@alice',
        referredUserId: 'u2',
        referredLabel: '@bob',
        rewardType: 'referrer_conversion_l1_days',
        level: 1,
        daysGranted: 10,
        trafficGbGranted: 0,
        status: 'granted',
        createdAt: new Date().toISOString(),
      },
    ],
    total: 1,
    page: 0,
    pageSize: 20,
  };
  const settingsResult = { id: 's1', enabled: true, referredSignupBonusType: 'traffic_gb', milestones: [] };

  const fakeGetReferralOverviewUseCase = { execute: jest.fn().mockResolvedValue(statsResult) };
  const fakeGetTopReferrersUseCase = { execute: jest.fn().mockResolvedValue(topResult) };
  const fakeListReferralRewardsUseCase = { execute: jest.fn().mockResolvedValue(rewardsResult) };
  const fakeReferralSettingsService = {
    get: jest.fn().mockResolvedValue(settingsResult),
    update: jest.fn().mockImplementation(async (data: Record<string, unknown>) => ({ ...settingsResult, ...data })),
  };

  const app = createAdminHttpApp({
    bot: fakeBot as never,
    cacheService,
    remnawaveService: fakeRemnawaveService as never,
    getAdminOverviewUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    listUsersUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getUserDetailUseCase: { execute: jest.fn().mockResolvedValue(null) } as never,
    listPaymentsUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    listNotificationLogsUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    listAuditLogsUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    sendCustomNotificationUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getUsersGrowthUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getSystemHealthUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getReferralOverviewUseCase: fakeGetReferralOverviewUseCase as never,
    getTopReferrersUseCase: fakeGetTopReferrersUseCase as never,
    listReferralRewardsUseCase: fakeListReferralRewardsUseCase as never,
    referralSettingsService: fakeReferralSettingsService as never,
    listServerCostsUseCase: { execute: jest.fn().mockResolvedValue([]) } as never,
    upsertServerCostUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    deleteServerCostUseCase: { execute: jest.fn().mockResolvedValue(undefined) } as never,
    getServerCostSummaryUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    listPlansUseCase: { execute: jest.fn().mockResolvedValue([]) } as never,
    createPlanUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    updatePlanUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    deletePlanUseCase: { execute: jest.fn().mockResolvedValue(undefined) } as never,
  });

  let authCookie: string[];

  beforeAll(async () => {
    const sessionId = await createAdminSession(cacheService, 4242);
    authCookie = [`${ADMIN_SESSION_COOKIE}=${sessionId}`];
  });

  describe('auth gating (401 without a session)', () => {
    it.each([
      ['GET', '/api/referrals/stats'],
      ['GET', '/api/referrals/top'],
      ['GET', '/api/referrals'],
      ['GET', '/api/referrals/settings'],
      ['PUT', '/api/referrals/settings'],
    ])('%s %s requires a session', async (method, path) => {
      const res = await request(app)[method.toLowerCase() as 'get' | 'put'](path);
      expect(res.status).toBe(401);
    });
  });

  describe('happy paths (authenticated)', () => {
    it('GET /api/referrals/stats returns the KPI overview', async () => {
      const res = await request(app).get('/api/referrals/stats').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(statsResult);
    });

    it('GET /api/referrals/top defaults the limit to 10', async () => {
      const res = await request(app).get('/api/referrals/top').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(topResult);
      expect(fakeGetTopReferrersUseCase.execute).toHaveBeenCalledWith(10);
    });

    it('GET /api/referrals/top forwards a custom limit, capped at 100', async () => {
      await request(app).get('/api/referrals/top?limit=500').set('Cookie', authCookie);
      expect(fakeGetTopReferrersUseCase.execute).toHaveBeenLastCalledWith(100);

      await request(app).get('/api/referrals/top?limit=3').set('Cookie', authCookie);
      expect(fakeGetTopReferrersUseCase.execute).toHaveBeenLastCalledWith(3);
    });

    it('GET /api/referrals lists the reward feed and forwards pagination', async () => {
      const res = await request(app).get('/api/referrals?page=2&pageSize=5').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(rewardsResult);
      expect(fakeListReferralRewardsUseCase.execute).toHaveBeenCalledWith({ page: 2, pageSize: 5 });
    });

    it('GET /api/referrals/settings returns the current settings', async () => {
      const res = await request(app).get('/api/referrals/settings').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(settingsResult);
    });

    it('PUT /api/referrals/settings forwards a valid partial update', async () => {
      const res = await request(app)
        .put('/api/referrals/settings')
        .set('Cookie', authCookie)
        .send({ enabled: false, conversionRewardFlatDays: 15 });

      expect(res.status).toBe(200);
      expect(fakeReferralSettingsService.update).toHaveBeenCalledWith({
        enabled: false,
        conversionRewardFlatDays: 15,
      });
    });

    it('PUT /api/referrals/settings rejects an invalid enum value without calling update', async () => {
      const res = await request(app)
        .put('/api/referrals/settings')
        .set('Cookie', authCookie)
        .send({ referredSignupBonusType: 'not_a_real_mode' });

      expect(res.status).toBe(400);
      expect(fakeReferralSettingsService.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ referredSignupBonusType: 'not_a_real_mode' }),
      );
    });

    it('PUT /api/referrals/settings rejects a negative integer field', async () => {
      const res = await request(app)
        .put('/api/referrals/settings')
        .set('Cookie', authCookie)
        .send({ maxBankedDays: -5 });

      expect(res.status).toBe(400);
    });

    it('PUT /api/referrals/settings ignores unknown fields instead of erroring', async () => {
      const res = await request(app)
        .put('/api/referrals/settings')
        .set('Cookie', authCookie)
        .send({ id: 'someone-elses-id', totallyUnknownField: 123, enabled: true });

      expect(res.status).toBe(200);
      expect(fakeReferralSettingsService.update).toHaveBeenLastCalledWith({ enabled: true });
    });

    it('PUT /api/referrals/settings accepts a valid milestones array', async () => {
      const milestones = [{ convertedCount: 5, bonusDays: 15 }];
      const res = await request(app)
        .put('/api/referrals/settings')
        .set('Cookie', authCookie)
        .send({ milestones });

      expect(res.status).toBe(200);
      expect(fakeReferralSettingsService.update).toHaveBeenLastCalledWith({ milestones });
    });

    it('PUT /api/referrals/settings rejects a malformed milestones array', async () => {
      const res = await request(app)
        .put('/api/referrals/settings')
        .set('Cookie', authCookie)
        .send({ milestones: [{ convertedCount: 5 }] });

      expect(res.status).toBe(400);
    });
  });
});
