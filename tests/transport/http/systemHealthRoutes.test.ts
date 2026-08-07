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

describe('system health routes — /api/system-health', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };
  const fakeUseCase = { execute: jest.fn().mockResolvedValue({}) };
  const fakeGetSystemHealthUseCase = { execute: jest.fn() };

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
    getUsersGrowthUseCase: fakeUseCase as never,
    getSystemHealthUseCase: fakeGetSystemHealthUseCase as never,
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/system-health');
    expect(res.status).toBe(401);
  });

  it('returns the use case result on success', async () => {
    const snapshot = { status: 'ok', components: [], warnings: [], recentErrors: [] };
    fakeGetSystemHealthUseCase.execute.mockResolvedValue(snapshot);

    const res = await request(app).get('/api/system-health').set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(snapshot);
  });

  it('returns 500 when the use case throws', async () => {
    fakeGetSystemHealthUseCase.execute.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/system-health').set('Cookie', authCookie);

    expect(res.status).toBe(500);
  });
});
