process.env['NODE_ENV'] = 'development';
process.env['ADMIN_TELEGRAM_IDS'] = '4242';
// ADMIN_DEV_USERNAME / ADMIN_DEV_PASSWORD intentionally not set.

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

describe('admin dev-login (disabled: credentials not configured)', () => {
  const app = createAdminHttpApp({
    bot: { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } } as never,
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
  });

  it('/api/auth/config reports devLoginEnabled: false', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.body).toEqual({ botUsername: 'test_admin_bot', devLoginEnabled: false });
  });

  it('the dev-login route does not exist at all (404, not 401)', async () => {
    const res = await request(app)
      .post('/api/auth/dev-login')
      .send({ username: 'anyone', password: 'anything' });
    expect(res.status).toBe(404);
  });
});
