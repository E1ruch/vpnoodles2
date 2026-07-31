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

describe('overview routes — /api/overview/users-growth', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };
  const fakeUseCase = { execute: jest.fn().mockResolvedValue({}) };
  const fakeGetUsersGrowthUseCase = { execute: jest.fn() };

  const app = createAdminHttpApp({
    bot: fakeBot as never,
    cacheService,
    remnawaveService: fakeRemnawaveService as never,
    getAdminOverviewUseCase: fakeUseCase as never,
    listUsersUseCase: fakeUseCase as never,
    getUserDetailUseCase: fakeUseCase as never,
    listPaymentsUseCase: fakeUseCase as never,
    listNotificationLogsUseCase: fakeUseCase as never,
    listAuditLogsUseCase: fakeUseCase as never,
    sendCustomNotificationUseCase: fakeUseCase as never,
    getUsersGrowthUseCase: fakeGetUsersGrowthUseCase as never,
    getSystemHealthUseCase: fakeUseCase as never,
    getReferralOverviewUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getTopReferrersUseCase: { execute: jest.fn().mockResolvedValue([]) } as never,
    listReferralRewardsUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    referralSettingsService: { get: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as never,
  });

  let authCookie: string[];

  beforeAll(async () => {
    const sessionId = await createAdminSession(cacheService, 4242);
    authCookie = [`${ADMIN_SESSION_COOKIE}=${sessionId}`];
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/overview/users-growth?days=30');
    expect(res.status).toBe(401);
  });

  it('forwards a valid days value to the use case', async () => {
    fakeGetUsersGrowthUseCase.execute.mockResolvedValue({ days: 7, series: [] });

    const res = await request(app).get('/api/overview/users-growth?days=7').set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(fakeGetUsersGrowthUseCase.execute).toHaveBeenCalledWith(7);
    expect(res.body).toEqual({ days: 7, series: [] });
  });

  it('defaults to 30 days when the param is missing', async () => {
    fakeGetUsersGrowthUseCase.execute.mockResolvedValue({ days: 30, series: [] });

    await request(app).get('/api/overview/users-growth').set('Cookie', authCookie);

    expect(fakeGetUsersGrowthUseCase.execute).toHaveBeenCalledWith(30);
  });

  it('falls back to 30 days for an out-of-whitelist value instead of forwarding it', async () => {
    fakeGetUsersGrowthUseCase.execute.mockResolvedValue({ days: 30, series: [] });

    await request(app).get('/api/overview/users-growth?days=365').set('Cookie', authCookie);

    expect(fakeGetUsersGrowthUseCase.execute).toHaveBeenCalledWith(30);
  });
});
