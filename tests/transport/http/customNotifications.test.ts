import request from 'supertest';
import { createAdminHttpApp } from '../../../src/transport/http/server';
import type { ICacheService } from '../../../src/domain/interfaces/services';
import { ADMIN_SESSION_COOKIE, createAdminSession } from '../../../src/transport/http/middleware/adminAuth';
import { BroadcastLockedError, NotFoundError } from '../../../src/shared/errors/index';

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
  };
}

describe('customNotifications routes (/api/notifications/custom)', () => {
  const cacheService = createFakeCache();
  const fakeBot = { telegram: { getMe: jest.fn().mockResolvedValue({ username: 'test_admin_bot' }) } };
  const fakeRemnawaveService = { getNodes: jest.fn().mockResolvedValue([]) };
  const fakeUseCase = { execute: jest.fn().mockResolvedValue({}) };

  const fakeSendCustomNotificationUseCase = {
    execute: jest.fn(),
    getAudienceCount: jest.fn(),
  };

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
    sendCustomNotificationUseCase: fakeSendCustomNotificationUseCase as never,
  });

  let authCookie: string[];

  beforeAll(async () => {
    const sessionId = await createAdminSession(cacheService, 4242);
    authCookie = [`${ADMIN_SESSION_COOKIE}=${sessionId}`];
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/notifications/custom requires a session', async () => {
    const res = await request(app)
      .post('/api/notifications/custom')
      .send({ audience: 'all', text: 'hi' });
    expect(res.status).toBe(401);
  });

  it('GET /api/notifications/custom/audience-count requires a session', async () => {
    const res = await request(app).get('/api/notifications/custom/audience-count?audience=all');
    expect(res.status).toBe(401);
  });

  describe('validation (authenticated)', () => {
    it('rejects an invalid audience', async () => {
      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'segment', text: 'hi' });
      expect(res.status).toBe(400);
      expect(fakeSendCustomNotificationUseCase.execute).not.toHaveBeenCalled();
    });

    it('rejects audience "user" without a userId', async () => {
      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'user', text: 'hi' });
      expect(res.status).toBe(400);
    });

    it('rejects text over the Telegram length limit', async () => {
      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'all', text: 'x'.repeat(4097) });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed button URL', async () => {
      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'all', text: 'hi', button: { label: 'Open', url: 'not-a-url' } });
      expect(res.status).toBe(400);
    });

    it('rejects a non-http(s) button URL', async () => {
      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'all', text: 'hi', button: { label: 'Open', url: 'javascript:alert(1)' } });
      expect(res.status).toBe(400);
    });
  });

  describe('happy paths (authenticated)', () => {
    it('POST with audience "user" calls the use case with adminTelegramId from the session and returns 200', async () => {
      fakeSendCustomNotificationUseCase.execute.mockResolvedValue({
        audience: 'user',
        recipients: 1,
        sent: 1,
        failed: 0,
        queued: false,
        completion: Promise.resolve(),
      });

      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'user', userId: 'u1', text: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ audience: 'user', recipients: 1, sent: 1, failed: 0, queued: false });
      expect(fakeSendCustomNotificationUseCase.execute).toHaveBeenCalledWith({
        audience: 'user',
        userId: 'u1',
        text: 'hi',
        button: null,
        adminTelegramId: 4242,
      });
    });

    it('POST with audience "all" returns 202 and queued: true without the response awaiting completion', async () => {
      let resolveCompletion: () => void = () => undefined;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      fakeSendCustomNotificationUseCase.execute.mockResolvedValue({
        audience: 'all',
        recipients: 50,
        sent: 0,
        failed: 0,
        queued: true,
        completion,
      });

      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'all', text: 'hi everyone' });

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ audience: 'all', recipients: 50, sent: 0, failed: 0, queued: true });
      resolveCompletion();
    });

    it('GET /audience-count returns the use case count', async () => {
      fakeSendCustomNotificationUseCase.getAudienceCount.mockResolvedValue(42);

      const res = await request(app)
        .get('/api/notifications/custom/audience-count?audience=all')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 42 });
    });

    it('maps a NotFoundError from the use case to a 404', async () => {
      fakeSendCustomNotificationUseCase.execute.mockRejectedValue(new NotFoundError('User', 'missing'));

      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'user', userId: 'missing', text: 'hi' });

      expect(res.status).toBe(404);
    });

    it('maps a BroadcastLockedError from the use case to a 409', async () => {
      fakeSendCustomNotificationUseCase.execute.mockRejectedValue(new BroadcastLockedError());

      const res = await request(app)
        .post('/api/notifications/custom')
        .set('Cookie', authCookie)
        .send({ audience: 'all', text: 'hi' });

      expect(res.status).toBe(409);
    });
  });
});
