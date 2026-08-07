process.env['NODE_ENV'] = 'production';
process.env['ADMIN_TELEGRAM_IDS'] = '4242';
// Даже если креды заданы, в production dev-логин обязан быть недоступен.
process.env['ADMIN_DEV_USERNAME'] = 'devadmin';
process.env['ADMIN_DEV_PASSWORD'] = 'correct horse battery staple';

import request from 'supertest';
import { createAdminHttpApp } from '../../../src/transport/http/server';
import type { ICacheService } from '../../../src/domain/interfaces/services';

function createFakeCache(): ICacheService {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
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

describe('admin dev-login (production: credentials set but NODE_ENV=production)', () => {
  const app = createAdminHttpApp({
    bot: { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'prod_bot' }) } } as never,
    cacheService: createFakeCache(),
    remnawaveService: { getNodes: jest.fn().mockResolvedValue([]) } as never,
    getAdminOverviewUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    listUsersUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
    getUserDetailUseCase: { execute: jest.fn().mockResolvedValue({}) } as never,
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
  });

  it('/api/auth/config reports devLoginEnabled: false regardless of configured credentials', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.body).toEqual({ botUsername: 'prod_bot', devLoginEnabled: false });
  });

  it('the dev-login route does not exist in production even with valid credentials configured', async () => {
    const res = await request(app)
      .post('/api/auth/dev-login')
      .send({ username: 'devadmin', password: 'correct horse battery staple' });
    expect(res.status).toBe(404);
  });
});
