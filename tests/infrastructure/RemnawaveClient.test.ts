import { RemnawaveClient } from '../../src/infrastructure/remnawave/RemnawaveClient';
import type { ICacheService } from '../../src/domain/interfaces/services';

// Регрессия на рефакторинг: suspendUser/resumeUser/updateDeviceLimit/updateUserTag/
// extendUser/upgradeUser раньше каждый собирали PATCH-payload вручную (GET текущего
// пользователя → скопировать 10+ полей → PATCH). Вынесено в общий patchUser() —
// эти тесты фиксируют точную форму payload для каждого метода, чтобы при следующей
// правке никто не потерял поле незаметно.

/** Простой in-memory фейк ICacheService — без реального Redis, но с настоящим TTL/delete. */
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

const currentUserFixture = {
  uuid: 'rw-1',
  shortUuid: 'short-1',
  username: 'tg_123',
  status: 'ACTIVE',
  telegramId: 123,
  email: null,
  trojanPassword: 'trojan',
  vlessUuid: 'vless',
  ssPassword: 'ss',
  trafficLimitBytes: 1000,
  trafficLimitStrategy: 'NO_RESET',
  expireAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
  lastTrafficResetAt: new Date().toISOString(),
  description: 'desc',
  tag: 'PAID',
  hwidDeviceLimit: 3,
  activeInternalSquads: ['squad-1'],
  externalSquadUuid: null,
};

function mockFetch(getResponse: Record<string, unknown> = currentUserFixture) {
  let patchBody: Record<string, unknown> | null = null;
  const fetchMock = jest.fn(async (_url: string, options: { method: string; body?: string }) => {
    if (options.method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: getResponse }),
      };
    }
    if (options.method === 'PATCH') {
      patchBody = JSON.parse(options.body ?? '{}');
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: getResponse }),
      };
    }
    throw new Error(`unexpected method: ${options.method}`);
  });
  return { fetchMock, getPatchBody: () => patchBody };
}

describe('RemnawaveClient — patchUser (GET-modify-PATCH helper)', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const baseFields = {
    uuid: 'rw-1',
    username: 'tg_123',
    trafficLimitBytes: 1000,
    trafficLimitStrategy: 'NO_RESET',
    description: 'desc',
    telegramId: 123,
    email: null,
    activeInternalSquads: ['squad-1'],
    externalSquadUuid: null,
  };

  it('suspendUser: overrides only status, keeps everything else from the current user', async () => {
    const { fetchMock, getPatchBody } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    await client.suspendUser('rw-1');

    expect(getPatchBody()).toEqual({
      ...baseFields,
      status: 'DISABLED',
      expireAt: currentUserFixture.expireAt,
      tag: 'PAID',
      hwidDeviceLimit: 3,
    });
  });

  it('resumeUser: keeps a future expireAt untouched', async () => {
    const { fetchMock, getPatchBody } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    await client.resumeUser('rw-1');

    const body = getPatchBody();
    expect(body?.['status']).toBe('ACTIVE');
    expect(body?.['expireAt']).toBe(currentUserFixture.expireAt);
  });

  it('resumeUser: bumps expireAt to "now" when it already expired', async () => {
    const expiredUser = { ...currentUserFixture, expireAt: new Date(Date.now() - 60_000).toISOString() };
    const { fetchMock, getPatchBody } = mockFetch(expiredUser);
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    const before = Date.now();
    await client.resumeUser('rw-1');
    const after = Date.now();

    const body = getPatchBody();
    expect(body?.['status']).toBe('ACTIVE');
    const resumedAt = new Date(body?.['expireAt'] as string).getTime();
    expect(resumedAt).toBeGreaterThanOrEqual(before);
    expect(resumedAt).toBeLessThanOrEqual(after);
  });

  it('updateDeviceLimit: overrides only hwidDeviceLimit', async () => {
    const { fetchMock, getPatchBody } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    await client.updateDeviceLimit('rw-1', 7);

    expect(getPatchBody()).toEqual({
      ...baseFields,
      status: 'ACTIVE',
      expireAt: currentUserFixture.expireAt,
      tag: 'PAID',
      hwidDeviceLimit: 7,
    });
  });

  it('updateUserTag: overrides only tag', async () => {
    const { fetchMock, getPatchBody } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    await client.updateUserTag('rw-1', 'TRIAL');

    expect(getPatchBody()).toEqual({
      ...baseFields,
      status: 'ACTIVE',
      expireAt: currentUserFixture.expireAt,
      tag: 'TRIAL',
      hwidDeviceLimit: 3,
    });
  });

  it('extendUser: adds days on top of the current expireAt and activates the user', async () => {
    const { fetchMock, getPatchBody } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    await client.extendUser('rw-1', 30);

    const body = getPatchBody();
    expect(body?.['status']).toBe('ACTIVE');
    const expectedExpiry = new Date(
      new Date(currentUserFixture.expireAt).getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(body?.['expireAt']).toBe(expectedExpiry);
    // Остальные поля должны прийти из текущего пользователя без изменений.
    expect(body?.['hwidDeviceLimit']).toBe(3);
    expect(body?.['tag']).toBe('PAID');
  });

  it('upgradeUser: overrides tag/limits/expiry from options, keeps identity fields from current user', async () => {
    const { fetchMock, getPatchBody } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    const expireAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    await client.upgradeUser('rw-1', {
      tag: 'PAID_PREMIUM',
      deviceLimit: 5,
      trafficLimitBytes: 0,
      trafficLimitStrategy: 'NO_RESET',
      expireAt,
    });

    expect(getPatchBody()).toEqual({
      ...baseFields,
      status: 'ACTIVE',
      tag: 'PAID_PREMIUM',
      hwidDeviceLimit: 5,
      trafficLimitBytes: 0,
      trafficLimitStrategy: 'NO_RESET',
      expireAt: expireAt.toISOString(),
    });
  });
});

describe('RemnawaveClient — getUserSubscriptionState cache', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('caches the result: a second call within TTL does not hit the network', async () => {
    const { fetchMock } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    const first = await client.getUserSubscriptionState('rw-1');
    const second = await client.getUserSubscriptionState('rw-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second?.status).toBe('active');
  });

  it('different remnawaveUserId are cached separately (cache miss on a new key)', async () => {
    const { fetchMock } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const client = new RemnawaveClient(createFakeCache());

    await client.getUserSubscriptionState('rw-1');
    await client.getUserSubscriptionState('rw-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a mutation (extendUser) invalidates the cached state for that user', async () => {
    const { fetchMock } = mockFetch();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    const cache = createFakeCache();
    const client = new RemnawaveClient(cache);

    // Прогреваем кэш устаревшим состоянием (expireAt через 5 дней, как в фикстуре).
    await client.getUserSubscriptionState('rw-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // extendUser делает свой GET (не через кэш state) + PATCH, затем инвалидирует кэш.
    await client.extendUser('rw-1', 10);

    // Следующее чтение статуса обязано пойти в сеть заново, а не отдать протухший кэш —
    // именно эта гарантия защищает от того, чтобы "Мой VPN" показал старую дату сразу
    // после продления.
    fetchMock.mockClear();
    await client.getUserSubscriptionState('rw-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
