process.env['ADMIN_TELEGRAM_IDS'] = '4242';

import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import { createAdminHttpApp } from '../../../src/transport/http/server';
import type { ICacheService } from '../../../src/domain/interfaces/services';

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

const BOT_TOKEN = process.env['TELEGRAM_BOT_TOKEN'] as string;

function signPayload(fields: Record<string, string | number>): Record<string, string | number> {
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');

  const secretKey = createHash('sha256').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return { ...fields, hash };
}

describe('admin http server', () => {
  const cacheService = createFakeCache();
  const fakeBot = {
    telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) },
  };
  const fakeRemnawaveService = {
    getNodes: jest.fn().mockResolvedValue([]),
  };
  const overviewResult = {
    usersCount: 3,
    activeUsersCount: 2,
    subscriptionsCount: 1,
    activeSubscriptionsCount: 1,
    paymentsCount: 5,
    logsCount: 10,
    revenue: { today: [], last7Days: [], last30Days: [], allTime: [] },
    notifications: { total: 0, delivered: 0, failed: 0, byType: [] },
  };
  const fakeGetAdminOverviewUseCase = {
    execute: jest.fn().mockResolvedValue(overviewResult),
  };
  const fakeListUsersUseCase = { execute: jest.fn().mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20 }) };
  const fakeGetUserDetailUseCase = { execute: jest.fn().mockResolvedValue(null) };
  const fakeListPaymentsUseCase = { execute: jest.fn().mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20 }) };
  const fakeListNotificationLogsUseCase = { execute: jest.fn().mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20 }) };
  const fakeListAuditLogsUseCase = { execute: jest.fn().mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 20 }) };

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

  it('GET /api/auth/config returns the bot username', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ botUsername: 'test_admin_bot', devLoginEnabled: false });
  });

  it('rejects /api/overview without a session cookie', async () => {
    const res = await request(app).get('/api/overview');
    expect(res.status).toBe(401);
  });

  it('rejects Telegram login with a tampered signature', async () => {
    const payload = signPayload({ id: 4242, first_name: 'Admin', auth_date: Math.floor(Date.now() / 1000) });
    const res = await request(app)
      .post('/api/auth/telegram')
      .send({ ...payload, hash: 'deadbeef'.repeat(8) });
    expect(res.status).toBe(401);
  });

  it('rejects Telegram login for an id outside ADMIN_TELEGRAM_IDS', async () => {
    const payload = signPayload({ id: 999, first_name: 'Nobody', auth_date: Math.floor(Date.now() / 1000) });
    const res = await request(app).post('/api/auth/telegram').send(payload);
    expect(res.status).toBe(403);
  });

  it('logs in an allowlisted admin and allows /api/overview with the resulting session cookie', async () => {
    const payload = signPayload({ id: 4242, first_name: 'Admin', auth_date: Math.floor(Date.now() / 1000) });
    const loginRes = await request(app).post('/api/auth/telegram').send(payload);
    expect(loginRes.status).toBe(200);

    const cookies = loginRes.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const meRes = await request(app).get('/api/auth/me').set('Cookie', cookies as unknown as string[]);
    expect(meRes.status).toBe(200);
    expect(meRes.body).toEqual({ telegramId: 4242 });

    const overviewRes = await request(app).get('/api/overview').set('Cookie', cookies as unknown as string[]);
    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body).toEqual({ ...overviewResult, nodes: [] });
  });

  it('logout clears the session so /api/overview goes back to 401', async () => {
    const payload = signPayload({ id: 4242, first_name: 'Admin', auth_date: Math.floor(Date.now() / 1000) });
    const loginRes = await request(app).post('/api/auth/telegram').send(payload);
    const cookies = loginRes.headers['set-cookie'] as unknown as string[];

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookies);
    expect(logoutRes.status).toBe(200);

    const overviewRes = await request(app).get('/api/overview').set('Cookie', cookies);
    expect(overviewRes.status).toBe(401);
  });
});
