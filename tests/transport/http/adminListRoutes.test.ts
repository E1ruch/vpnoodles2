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
    async ping(): Promise<boolean> { return true; },
  };
}

describe('admin list/detail routes (users, payments, notifications, logs)', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };
  const fakeGetAdminOverviewUseCase = { execute: jest.fn().mockResolvedValue({}) };

  const usersResult = { items: [{ id: 'u1', telegramId: 1, username: 'alice' }], total: 1, page: 0, pageSize: 20 };
  const userDetail = { id: 'u1', telegramId: 1, username: 'alice', subscriptions: [], payments: [], recentActions: [] };
  const paymentsResult = { items: [{ id: 'p1', userId: 'u1', userLabel: '@alice' }], total: 1, page: 0, pageSize: 20 };
  const notificationsResult = { items: [{ id: 'n1', userId: 'u1', userLabel: '@alice' }], total: 1, page: 0, pageSize: 20 };
  const logsResult = { items: [{ id: 'l1', userId: 'u1', userLabel: '@alice' }], total: 1, page: 0, pageSize: 20 };

  const fakeListUsersUseCase = { execute: jest.fn().mockResolvedValue(usersResult) };
  const fakeGetUserDetailUseCase = { execute: jest.fn().mockResolvedValue(userDetail) };
  const fakeListPaymentsUseCase = { execute: jest.fn().mockResolvedValue(paymentsResult) };
  const fakeListNotificationLogsUseCase = { execute: jest.fn().mockResolvedValue(notificationsResult) };
  const fakeListAuditLogsUseCase = { execute: jest.fn().mockResolvedValue(logsResult) };

  const app = createAdminHttpApp({
    bot: fakeBot as never,
    cacheService,
    remnawaveService: fakeRemnawaveService as never,
    getAdminOverviewUseCase: fakeGetAdminOverviewUseCase as never,
    listUsersUseCase: fakeListUsersUseCase as never,
    getUserDetailUseCase: fakeGetUserDetailUseCase as never,
    listPaymentsUseCase: fakeListPaymentsUseCase as never,
    listNotificationLogsUseCase: fakeListNotificationLogsUseCase as never,
    listAuditLogsUseCase: fakeListAuditLogsUseCase as never,
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
  });

  let authCookie: string[];

  beforeAll(async () => {
    const sessionId = await createAdminSession(cacheService, 4242);
    authCookie = [`${ADMIN_SESSION_COOKIE}=${sessionId}`];
  });

  describe('auth gating (401 without a session)', () => {
    it.each([
      ['GET', '/api/users'],
      ['GET', '/api/users/u1'],
      ['GET', '/api/payments'],
      ['GET', '/api/notifications'],
      ['GET', '/api/logs'],
    ])('%s %s requires a session', async (method, path) => {
      const res = await request(app)[method.toLowerCase() as 'get'](path);
      expect(res.status).toBe(401);
    });
  });

  describe('happy paths (authenticated)', () => {
    it('GET /api/users lists users and forwards search/page query params', async () => {
      const res = await request(app)
        .get('/api/users?search=alice&page=1&pageSize=5')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(usersResult);
      expect(fakeListUsersUseCase.execute).toHaveBeenCalledWith({ search: 'alice', page: 1, pageSize: 5 });
    });

    it('GET /api/users/:id returns the user detail', async () => {
      const res = await request(app).get('/api/users/u1').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(userDetail);
      expect(fakeGetUserDetailUseCase.execute).toHaveBeenCalledWith('u1');
    });

    it('GET /api/users/:id returns 404 when the use case returns null', async () => {
      fakeGetUserDetailUseCase.execute.mockResolvedValueOnce(null);

      const res = await request(app).get('/api/users/missing').set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });

    it('GET /api/payments lists payments and forwards a valid status filter', async () => {
      const res = await request(app).get('/api/payments?status=completed').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(paymentsResult);
      expect(fakeListPaymentsUseCase.execute).toHaveBeenCalledWith({ status: 'completed', page: 0, pageSize: 20 });
    });

    it('GET /api/payments ignores an invalid status value instead of forwarding it', async () => {
      await request(app).get('/api/payments?status=not-a-real-status').set('Cookie', authCookie);

      expect(fakeListPaymentsUseCase.execute).toHaveBeenLastCalledWith({ status: undefined, page: 0, pageSize: 20 });
    });

    it('GET /api/notifications lists notification logs and forwards a valid type filter', async () => {
      const res = await request(app).get('/api/notifications?type=trial_expiring_2d').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(notificationsResult);
      expect(fakeListNotificationLogsUseCase.execute).toHaveBeenCalledWith({
        type: 'trial_expiring_2d',
        page: 0,
        pageSize: 20,
      });
    });

    it('GET /api/logs lists audit logs', async () => {
      const res = await request(app).get('/api/logs').set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(logsResult);
      expect(fakeListAuditLogsUseCase.execute).toHaveBeenCalledWith({ page: 0, pageSize: 20 });
    });
  });
});
