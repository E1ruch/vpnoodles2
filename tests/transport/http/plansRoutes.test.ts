import request from 'supertest';
import { createAdminHttpApp } from '../../../src/transport/http/server';
import type { ICacheService } from '../../../src/domain/interfaces/services';
import { ADMIN_SESSION_COOKIE, createAdminSession } from '../../../src/transport/http/middleware/adminAuth';
import { PlanInUseError } from '../../../src/shared/errors/index';

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

describe('admin plan routes', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };

  const validPayload = {
    name: 'Pro',
    type: 'paid',
    durationDays: 30,
    deviceLimit: 3,
    priceStars: 500,
    priceRub: 299,
    isActive: true,
    sortOrder: 1,
    remnawaveTag: 'pro',
    description: null,
  };
  const planResult = { id: 'p1', ...validPayload, activeSubscriptionsCount: 4 };

  const fakeListPlansUseCase = { execute: jest.fn().mockResolvedValue([planResult]) };
  const fakeCreatePlanUseCase = { execute: jest.fn().mockResolvedValue(planResult) };
  const fakeUpdatePlanUseCase = { execute: jest.fn().mockResolvedValue(planResult) };
  const fakeDeletePlanUseCase = { execute: jest.fn().mockResolvedValue(undefined) };

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
    listServerCostsUseCase: { execute: jest.fn().mockResolvedValue([]) } as never,
    upsertServerCostUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    deleteServerCostUseCase: { execute: jest.fn().mockResolvedValue(undefined) } as never,
    getServerCostSummaryUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    listPlansUseCase: fakeListPlansUseCase as never,
    createPlanUseCase: fakeCreatePlanUseCase as never,
    updatePlanUseCase: fakeUpdatePlanUseCase as never,
    deletePlanUseCase: fakeDeletePlanUseCase as never,
  });

  let authCookie: string[];

  beforeAll(async () => {
    const sessionId = await createAdminSession(cacheService, 4242);
    authCookie = [`${ADMIN_SESSION_COOKIE}=${sessionId}`];
  });

  describe('auth gating (401 without a session)', () => {
    it.each([
      ['GET', '/api/plans'],
      ['POST', '/api/plans'],
      ['PUT', '/api/plans/p1'],
      ['DELETE', '/api/plans/p1'],
    ])('%s %s requires a session', async (method, path) => {
      const res = await request(app)[method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](path);
      expect(res.status).toBe(401);
    });
  });

  describe('happy paths (authenticated)', () => {
    it('GET /api/plans returns the plan list with stats', async () => {
      const res = await request(app).get('/api/plans').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([planResult]);
    });

    it('POST /api/plans creates a plan from a valid payload', async () => {
      const res = await request(app).post('/api/plans').set('Cookie', authCookie).send(validPayload);

      expect(res.status).toBe(201);
      expect(fakeCreatePlanUseCase.execute).toHaveBeenCalledWith(validPayload);
    });

    it('POST /api/plans rejects a missing name', async () => {
      const res = await request(app)
        .post('/api/plans')
        .set('Cookie', authCookie)
        .send({ ...validPayload, name: '' });

      expect(res.status).toBe(400);
      expect(fakeCreatePlanUseCase.execute).not.toHaveBeenCalledWith(expect.objectContaining({ name: '' }));
    });

    it('POST /api/plans rejects an invalid type', async () => {
      const res = await request(app)
        .post('/api/plans')
        .set('Cookie', authCookie)
        .send({ ...validPayload, type: 'enterprise' });

      expect(res.status).toBe(400);
    });

    it('POST /api/plans rejects a negative priceRub', async () => {
      const res = await request(app)
        .post('/api/plans')
        .set('Cookie', authCookie)
        .send({ ...validPayload, priceRub: -1 });

      expect(res.status).toBe(400);
    });

    it('POST /api/plans rejects a zero durationDays', async () => {
      const res = await request(app)
        .post('/api/plans')
        .set('Cookie', authCookie)
        .send({ ...validPayload, durationDays: 0 });

      expect(res.status).toBe(400);
    });

    it('PUT /api/plans/:id forwards a partial payload', async () => {
      const res = await request(app)
        .put('/api/plans/p1')
        .set('Cookie', authCookie)
        .send({ priceRub: 349, isActive: false });

      expect(res.status).toBe(200);
      expect(fakeUpdatePlanUseCase.execute).toHaveBeenCalledWith('p1', { priceRub: 349, isActive: false });
    });

    it('PUT /api/plans/:id rejects an invalid partial field', async () => {
      const res = await request(app).put('/api/plans/p1').set('Cookie', authCookie).send({ deviceLimit: -1 });

      expect(res.status).toBe(400);
    });

    it('DELETE /api/plans/:id deletes the plan', async () => {
      const res = await request(app).delete('/api/plans/p1').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(fakeDeletePlanUseCase.execute).toHaveBeenCalledWith('p1');
    });

    it('DELETE /api/plans/:id returns 409 when the plan is still referenced', async () => {
      fakeDeletePlanUseCase.execute.mockRejectedValueOnce(new PlanInUseError('p1'));

      const res = await request(app).delete('/api/plans/p1').set('Cookie', authCookie);

      expect(res.status).toBe(409);
    });
  });
});
