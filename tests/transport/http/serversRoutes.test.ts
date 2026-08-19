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

describe('admin server-cost routes', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };

  const costsResult = [
    {
      id: 'c1',
      nodeUuid: 'node-1',
      nodeName: 'Frankfurt-1',
      monthlyCostRub: 1500,
      nextPaymentDate: null,
      note: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const summaryResult = {
    totalMonthlyCostRub: 1500,
    currentMonthRevenueRub: 3000,
    coveragePercent: 200,
    monthlyHistory: [{ month: '2026-03', revenueRub: 3000, costRub: 1500 }],
  };

  const fakeListServerCostsUseCase = { execute: jest.fn().mockResolvedValue(costsResult) };
  const fakeUpsertServerCostUseCase = { execute: jest.fn().mockResolvedValue(costsResult[0]) };
  const fakeDeleteServerCostUseCase = { execute: jest.fn().mockResolvedValue(undefined) };
  const fakeGetServerCostSummaryUseCase = { execute: jest.fn().mockResolvedValue(summaryResult) };

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
    getReferralOverviewUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getTopReferrersUseCase: { execute: jest.fn().mockResolvedValue([]) } as never,
    listReferralRewardsUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    referralSettingsService: { get: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as never,
    listServerCostsUseCase: fakeListServerCostsUseCase as never,
    upsertServerCostUseCase: fakeUpsertServerCostUseCase as never,
    deleteServerCostUseCase: fakeDeleteServerCostUseCase as never,
    getServerCostSummaryUseCase: fakeGetServerCostSummaryUseCase as never,
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
      ['GET', '/api/servers/costs'],
      ['PUT', '/api/servers/costs/node-1'],
      ['DELETE', '/api/servers/costs/node-1'],
      ['GET', '/api/servers/cost-summary'],
    ])('%s %s requires a session', async (method, path) => {
      const res = await request(app)[method.toLowerCase() as 'get' | 'put' | 'delete'](path);
      expect(res.status).toBe(401);
    });
  });

  describe('happy paths (authenticated)', () => {
    it('GET /api/servers/costs returns the cost list', async () => {
      const res = await request(app).get('/api/servers/costs').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(costsResult);
    });

    it('PUT /api/servers/costs/:nodeUuid forwards a valid payload', async () => {
      const payload = { monthlyCostRub: 1500, nextPaymentDate: null, note: 'Hetzner', nodeName: 'Frankfurt-1' };
      const res = await request(app)
        .put('/api/servers/costs/node-1')
        .set('Cookie', authCookie)
        .send(payload);

      expect(res.status).toBe(200);
      expect(fakeUpsertServerCostUseCase.execute).toHaveBeenCalledWith('node-1', payload);
    });

    it('PUT /api/servers/costs/:nodeUuid rejects a negative monthlyCostRub', async () => {
      const res = await request(app)
        .put('/api/servers/costs/node-1')
        .set('Cookie', authCookie)
        .send({ monthlyCostRub: -5 });

      expect(res.status).toBe(400);
      expect(fakeUpsertServerCostUseCase.execute).not.toHaveBeenCalledWith('node-1', expect.objectContaining({ monthlyCostRub: -5 }));
    });

    it('PUT /api/servers/costs/:nodeUuid rejects a malformed nextPaymentDate', async () => {
      const res = await request(app)
        .put('/api/servers/costs/node-1')
        .set('Cookie', authCookie)
        .send({ monthlyCostRub: 100, nextPaymentDate: 'not-a-date' });

      expect(res.status).toBe(400);
    });

    it('DELETE /api/servers/costs/:nodeUuid deletes the row', async () => {
      const res = await request(app).delete('/api/servers/costs/node-1').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(fakeDeleteServerCostUseCase.execute).toHaveBeenCalledWith('node-1');
    });

    it('GET /api/servers/cost-summary defaults months to 12', async () => {
      await request(app).get('/api/servers/cost-summary').set('Cookie', authCookie);
      expect(fakeGetServerCostSummaryUseCase.execute).toHaveBeenLastCalledWith(12);
    });

    it('GET /api/servers/cost-summary forwards a valid months value', async () => {
      const res = await request(app).get('/api/servers/cost-summary?months=6').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(summaryResult);
      expect(fakeGetServerCostSummaryUseCase.execute).toHaveBeenLastCalledWith(6);
    });

    it('GET /api/servers/cost-summary falls back to 12 for an invalid months value', async () => {
      await request(app).get('/api/servers/cost-summary?months=999').set('Cookie', authCookie);
      expect(fakeGetServerCostSummaryUseCase.execute).toHaveBeenLastCalledWith(12);
    });
  });
});
