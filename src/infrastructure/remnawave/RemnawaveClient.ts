import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { HwidDevice, HwidDevicesResult, RemnawaveNode } from '../../shared/types/index.js';
import { getLogger } from '../../shared/logger/index.js';
import { RemnawaveError } from '../../shared/errors/index.js';
import { getEnv } from '../../shared/config/env.js';
import { sleep } from '../../shared/utils/index.js';

// Remnawave API response types
// API возвращает ответы в формате { response: ... }
interface RemnawaveApiResponse<T> {
  response: T;
}

interface RemnawaveUser {
  uuid: string;
  shortUuid: string;
  username: string;
  status: string;
  telegramId: number | null;
  email: string | null;
  trojanPassword: string;
  vlessUuid: string;
  ssPassword: string;
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  expireAt: string;
  createdAt: string;
  lastTrafficResetAt: string;
  description: string;
  tag: string;
  hwidDeviceLimit: number;
  activeInternalSquads: Array<string | { uuid?: string; id?: string; name?: string }>;
  externalSquadUuid: string | null;
  subscriptionUrl?: string;
}

interface RemnawaveCreateUserPayload {
  username: string;
  status: string;
  shortUuid?: string;
  trojanPassword?: string;
  vlessUuid?: string;
  ssPassword?: string;
  trafficLimitBytes: number;
  trafficLimitStrategy: string;
  expireAt: string;
  description?: string;
  tag?: string;
  telegramId: number | null;
  email?: string | null;
  hwidDeviceLimit: number;
  activeInternalSquads?: string[];
  uuid?: string;
  externalSquadUuid?: string | null;
}

interface RemnawaveNodeApi {
  uuid: string;
  name: string;
  usersOnline: number;
  isConnected: boolean;
  isDisabled: boolean;
  isConnecting: boolean;
  versions?: {
    xray?: string;
  };
  system?: {
    stats?: {
      memoryFree: number;
      memoryUsed: number;
      uptime: number;
      loadAvg: number[];
      interface?: {
        rxBytesPerSec: number;
        txBytesPerSec: number;
      };
    };
  };
}

interface RemnawaveUpdateUserPayload {
  uuid?: string;
  username?: string;
  status?: string;
  trafficLimitBytes?: number;
  trafficLimitStrategy?: string;
  expireAt?: string;
  description?: string | null;
  tag?: string;
  telegramId?: number | null;
  email?: string | null;
  hwidDeviceLimit?: number;
  activeInternalSquads?: string[];
  externalSquadUuid?: string | null;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

export class RemnawaveClient implements IRemnawaveService {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor() {
    const env = getEnv();
    this.baseUrl = env.REMNAWAVE_API_URL.replace(/\/$/, '');
    this.apiKey = env.REMNAWAVE_API_KEY;
    this.timeoutMs = env.REMNAWAVE_TIMEOUT_MS;
  }

  async findUserByUsername(username: string): Promise<string | null> {
    const logger = getLogger();
    logger.info({ username }, 'Finding Remnawave user by username');

    try {
      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>(
        'GET',
        `/api/users/by-username/${username}`,
      );
      const user = raw.response;
      logger.info({ username, uuid: user.uuid }, 'Remnawave user found by username');
      return user.uuid;
    } catch (error) {
      // Если пользователь не найден (404), возвращаем null
      if (error instanceof RemnawaveError && error.message.includes('404')) {
        logger.info({ username }, 'Remnawave user not found by username (404)');
        return null;
      }
      logger.error({ error, username }, 'Error finding user by username');
      throw error;
    }
  }

  async createUser(
    telegramId: number,
    username: string,
    tag: string,
    activeInternalSquads: string[],
    options?: {
      trafficLimitBytes?: number;
      trafficLimitStrategy?: 'NO_RESET' | 'DAY' | 'MONTH';
      expireAt?: Date;
      deviceLimit?: number;
    },
  ): Promise<string> {
    const logger = getLogger();
    // PostgreSQL bigint может возвращать строку, поэтому принудительно конвертируем в число
    const numericTelegramId = Number(telegramId);
    logger.info(
      { telegramId: numericTelegramId, username, tag, activeInternalSquads, options },
      'Creating Remnawave user',
    );

    return this.withRetry(async () => {
      // Сначала проверяем, существует ли уже пользователь с таким username
      const existingUuid = await this.findUserByUsername(`tg_${numericTelegramId}`);
      if (existingUuid) {
        logger.info(
          { remnawaveUserId: existingUuid },
          'Remnawave user already exists, returning existing UUID',
        );
        return existingUuid;
      }

      const payload: RemnawaveCreateUserPayload = {
        username: `tg_${numericTelegramId}`,
        status: 'ACTIVE',
        trafficLimitBytes: options?.trafficLimitBytes ?? 0,
        trafficLimitStrategy: options?.trafficLimitStrategy ?? 'NO_RESET',
        expireAt:
          options?.expireAt?.toISOString() ??
          new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        telegramId: numericTelegramId,
        hwidDeviceLimit: options?.deviceLimit ?? 1,
        description: `Telegram user: ${username || numericTelegramId}`,
        tag,
        activeInternalSquads,
      };

      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>(
        'POST',
        '/api/users',
        payload,
      );
      const response = raw.response;

      logger.info({ remnawaveUserId: response.uuid }, 'Remnawave user created');
      return response.uuid;
    });
  }

  async deleteUser(remnawaveUserId: string): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId }, 'Deleting Remnawave user');

    await this.withRetry(async () => {
      await this.request<void>('DELETE', `/api/users/${remnawaveUserId}`);
      logger.info({ remnawaveUserId }, 'Remnawave user deleted');
    });
  }

  async suspendUser(remnawaveUserId: string): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId }, 'Suspending Remnawave user');

    await this.withRetry(async () => {
      const currentUser = await this.getUser(remnawaveUserId);
      const payload: RemnawaveUpdateUserPayload = {
        uuid: remnawaveUserId,
        username: currentUser.username,
        status: 'DISABLED',
        trafficLimitBytes: currentUser.trafficLimitBytes,
        trafficLimitStrategy: currentUser.trafficLimitStrategy,
        expireAt: currentUser.expireAt,
        description: currentUser.description,
        tag: currentUser.tag,
        telegramId: currentUser.telegramId,
        email: currentUser.email,
        hwidDeviceLimit: currentUser.hwidDeviceLimit,
        activeInternalSquads: this.normalizeInternalSquads(currentUser.activeInternalSquads),
        externalSquadUuid: currentUser.externalSquadUuid,
      };
      await this.request<RemnawaveUser>('PATCH', '/api/users', payload);
      logger.info({ remnawaveUserId }, 'Remnawave user suspended');
    });
  }

  async resumeUser(remnawaveUserId: string): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId }, 'Resuming Remnawave user');

    await this.withRetry(async () => {
      const currentUser = await this.getUser(remnawaveUserId);
      const currentExpiry = new Date(currentUser.expireAt);
      const expireAt =
        currentExpiry.getTime() > Date.now()
          ? currentUser.expireAt
          : new Date().toISOString();

      const payload: RemnawaveUpdateUserPayload = {
        uuid: remnawaveUserId,
        username: currentUser.username,
        status: 'ACTIVE',
        trafficLimitBytes: currentUser.trafficLimitBytes,
        trafficLimitStrategy: currentUser.trafficLimitStrategy,
        expireAt,
        description: currentUser.description,
        tag: currentUser.tag,
        telegramId: currentUser.telegramId,
        email: currentUser.email,
        hwidDeviceLimit: currentUser.hwidDeviceLimit,
        activeInternalSquads: this.normalizeInternalSquads(currentUser.activeInternalSquads),
        externalSquadUuid: currentUser.externalSquadUuid,
      };
      await this.request<RemnawaveUser>('PATCH', '/api/users', payload);
      logger.info({ remnawaveUserId }, 'Remnawave user resumed');
    });
  }

  async getSubscriptionUrl(remnawaveUserId: string): Promise<string> {
    const logger = getLogger();
    logger.info({ remnawaveUserId }, 'Getting subscription URL');

    return this.withRetry(async () => {
      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>(
        'GET',
        `/api/users/${remnawaveUserId}`,
      );
      const response = raw.response;

      // Remnawave returns subscription URL in the user object
      if (response.subscriptionUrl) {
        return response.subscriptionUrl;
      }

      // Fallback: construct subscription URL from the panel base URL and shortUuid
      const env = getEnv();
      const panelUrl = env.REMNAWAVE_API_URL.replace(/\/api$/, '').replace(/\/$/, '');
      return `${panelUrl}/sub/${response.shortUuid}`;
    });
  }

  async updateDeviceLimit(remnawaveUserId: string, limit: number): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId, limit }, 'Updating device limit');

    await this.withRetry(async () => {
      const currentUser = await this.getUser(remnawaveUserId);
      const payload: RemnawaveUpdateUserPayload = {
        uuid: remnawaveUserId,
        username: currentUser.username,
        status: currentUser.status,
        trafficLimitBytes: currentUser.trafficLimitBytes,
        trafficLimitStrategy: currentUser.trafficLimitStrategy,
        expireAt: currentUser.expireAt,
        description: currentUser.description,
        tag: currentUser.tag,
        telegramId: currentUser.telegramId,
        email: currentUser.email,
        hwidDeviceLimit: limit,
        activeInternalSquads: this.normalizeInternalSquads(currentUser.activeInternalSquads),
        externalSquadUuid: currentUser.externalSquadUuid,
      };
      await this.request<RemnawaveUser>('PATCH', '/api/users', payload);
      logger.info({ remnawaveUserId, limit }, 'Device limit updated');
    });
  }

  async updateUserTag(remnawaveUserId: string, tag: string): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId, tag }, 'Updating user tag');

    await this.withRetry(async () => {
      const currentUser = await this.getUser(remnawaveUserId);
      const payload: RemnawaveUpdateUserPayload = {
        uuid: remnawaveUserId,
        username: currentUser.username,
        status: currentUser.status,
        trafficLimitBytes: currentUser.trafficLimitBytes,
        trafficLimitStrategy: currentUser.trafficLimitStrategy,
        expireAt: currentUser.expireAt,
        description: currentUser.description,
        tag,
        telegramId: currentUser.telegramId,
        email: currentUser.email,
        hwidDeviceLimit: currentUser.hwidDeviceLimit,
        activeInternalSquads: this.normalizeInternalSquads(currentUser.activeInternalSquads),
        externalSquadUuid: currentUser.externalSquadUuid,
      };
      await this.request<RemnawaveUser>('PATCH', '/api/users', payload);
      logger.info({ remnawaveUserId, tag }, 'User tag updated');
    });
  }

  async extendUser(remnawaveUserId: string, days: number): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId, days }, 'Extending user subscription');

    await this.withRetry(async () => {
      // First get current user to read expireAt
      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>(
        'GET',
        `/api/users/${remnawaveUserId}`,
      );
      const currentUser = raw.response;

      const currentExpiry = new Date(currentUser.expireAt);
      const newExpiry = new Date(
        Math.max(currentExpiry.getTime(), Date.now()) + days * 24 * 60 * 60 * 1000,
      );

      const payload: RemnawaveUpdateUserPayload = {
        uuid: remnawaveUserId,
        username: currentUser.username,
        status: 'ACTIVE',
        trafficLimitBytes: currentUser.trafficLimitBytes,
        trafficLimitStrategy: currentUser.trafficLimitStrategy,
        expireAt: newExpiry.toISOString(),
        description: currentUser.description,
        tag: currentUser.tag,
        telegramId: currentUser.telegramId,
        email: currentUser.email,
        hwidDeviceLimit: currentUser.hwidDeviceLimit,
        activeInternalSquads: this.normalizeInternalSquads(currentUser.activeInternalSquads),
        externalSquadUuid: currentUser.externalSquadUuid,
      };
      await this.request<RemnawaveUser>('PATCH', '/api/users', payload);
      logger.info(
        { remnawaveUserId, days, newExpiry: newExpiry.toISOString() },
        'User subscription extended',
      );
    });
  }

  async upgradeUser(
    remnawaveUserId: string,
    options: {
      tag: string;
      deviceLimit: number;
      trafficLimitBytes: number;
      trafficLimitStrategy: 'NO_RESET' | 'DAY' | 'MONTH';
      expireAt: Date;
    },
  ): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId, options }, 'Upgrading user to paid plan');

    await this.withRetry(async () => {
      // Сначала получаем текущего пользователя для получения username
      const currentUser = await this.getUser(remnawaveUserId);

      const payload: RemnawaveUpdateUserPayload = {
        uuid: remnawaveUserId,
        username: currentUser.username,
        tag: options.tag,
        hwidDeviceLimit: options.deviceLimit,
        trafficLimitBytes: options.trafficLimitBytes,
        trafficLimitStrategy: options.trafficLimitStrategy,
        expireAt: options.expireAt.toISOString(),
        status: 'ACTIVE',
        telegramId: currentUser.telegramId,
        email: currentUser.email,
        description: currentUser.description,
        activeInternalSquads: this.normalizeInternalSquads(currentUser.activeInternalSquads),
        externalSquadUuid: currentUser.externalSquadUuid,
      };
      await this.request<RemnawaveUser>('PATCH', '/api/users', payload);
      logger.info({ remnawaveUserId, options }, 'User upgraded to paid plan');
    });
  }

  async getUserSubscriptionState(
    remnawaveUserUuid: string,
  ): Promise<{ expireAt: Date; status: 'active' | 'expired' } | null> {
    const logger = getLogger();

    try {
      const user = await this.getUser(remnawaveUserUuid);
      const expireAt = new Date(user.expireAt);
      if (Number.isNaN(expireAt.getTime())) {
        logger.warn({ remnawaveUserUuid, expireAt: user.expireAt }, 'Invalid expireAt from Remnawave');
        return null;
      }

      const now = new Date();
      const status = user.status === 'ACTIVE' && expireAt > now ? 'active' : 'expired';
      return { expireAt, status };
    } catch (error) {
      if (error instanceof RemnawaveError && error.message.includes('404')) {
        logger.info({ remnawaveUserUuid }, 'Remnawave user state: 404 → skip sync');
        return null;
      }
      throw error;
    }
  }

  async getUserExpireAt(remnawaveUserUuid: string): Promise<Date | null> {
    const state = await this.getUserSubscriptionState(remnawaveUserUuid);
    return state?.expireAt ?? null;
  }

  async getHwidDeviceTotal(remnawaveUserUuid: string): Promise<number> {
    const { total } = await this.getHwidDevices(remnawaveUserUuid);
    return total;
  }

  async getHwidDevices(remnawaveUserUuid: string): Promise<HwidDevicesResult> {
    const logger = getLogger();

    try {
      const raw = await this.request<RemnawaveApiResponse<HwidDevicesResult>>(
        'GET',
        `/api/hwid/devices/${encodeURIComponent(remnawaveUserUuid)}`,
      );
      return this.normalizeHwidDevicesResponse(raw.response);
    } catch (error) {
      if (error instanceof RemnawaveError && error.message.includes('404')) {
        logger.info({ remnawaveUserUuid }, 'Remnawave HWID devices: 404 → empty');
        return { total: 0, devices: [] };
      }
      throw error;
    }
  }

  async getNodes(): Promise<RemnawaveNode[]> {
    const logger = getLogger();
    logger.info('Fetching Remnawave nodes');

    const raw = await this.request<RemnawaveApiResponse<RemnawaveNodeApi[]>>('GET', '/api/nodes');
    const nodes = Array.isArray(raw.response) ? raw.response : [];

    return nodes.map((node) => {
      const stats = node.system?.stats;
      const iface = stats?.interface;

      return {
        uuid: node.uuid,
        name: node.name,
        usersOnline: typeof node.usersOnline === 'number' ? node.usersOnline : 0,
        isConnected: Boolean(node.isConnected),
        isDisabled: Boolean(node.isDisabled),
        isConnecting: Boolean(node.isConnecting),
        versions: node.versions?.xray ? { xray: node.versions.xray } : undefined,
        system: stats
          ? {
              stats: {
                memoryFree: stats.memoryFree,
                memoryUsed: stats.memoryUsed,
                uptime: stats.uptime,
                loadAvg: Array.isArray(stats.loadAvg) ? stats.loadAvg : [],
                interface:
                  iface &&
                  typeof iface.rxBytesPerSec === 'number' &&
                  typeof iface.txBytesPerSec === 'number'
                    ? {
                        rxBytesPerSec: iface.rxBytesPerSec,
                        txBytesPerSec: iface.txBytesPerSec,
                      }
                    : undefined,
              },
            }
          : undefined,
      };
    });
  }

  async deleteHwidDevice(remnawaveUserUuid: string, hwid: string): Promise<HwidDevicesResult> {
    const raw = await this.request<RemnawaveApiResponse<HwidDevicesResult>>(
      'POST',
      '/api/hwid/devices/delete',
      { userUuid: remnawaveUserUuid, hwid },
    );
    return this.normalizeHwidDevicesResponse(raw.response);
  }

  private normalizeHwidDevicesResponse(payload: HwidDevicesResult | undefined): HwidDevicesResult {
    const devices = Array.isArray(payload?.devices)
      ? payload.devices.filter((d): d is HwidDevice => typeof d?.hwid === 'string')
      : [];
    const total =
      typeof payload?.total === 'number' && Number.isFinite(payload.total)
        ? Math.max(0, Math.floor(payload.total))
        : devices.length;
    return { total, devices };
  }

  private async getUser(remnawaveUserId: string): Promise<RemnawaveUser> {
    const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>(
      'GET',
      `/api/users/${remnawaveUserId}`,
    );
    return raw.response;
  }

  private normalizeInternalSquads(
    squads: Array<string | { uuid?: string; id?: string; name?: string }> | undefined,
  ): string[] {
    if (!Array.isArray(squads)) return [];
    return squads
      .map((item) => {
        if (typeof item === 'string') return item;
        return item.uuid ?? item.id ?? null;
      })
      .filter((value): value is string => Boolean(value));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const logger = getLogger();
    const url = `${this.baseUrl}${path}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const options: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      };

      if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(url, options);

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        logger.error({ status: res.status, path, errorBody }, 'Remnawave API error');
        throw new RemnawaveError(`API error ${res.status} on ${path}: ${errorBody}`);
      }

      // For DELETE requests that may return 204 No Content
      if (res.status === 204) {
        return undefined as T;
      }

      const data = (await res.json()) as T;
      return data;
    } catch (error) {
      if (error instanceof RemnawaveError) throw error;
      logger.error({ error, path }, 'Remnawave request failed');
      throw new RemnawaveError(`Request failed: ${path}`, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, retries: number = MAX_RETRIES): Promise<T> {
    const logger = getLogger();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < retries) {
          logger.warn({ attempt, error: lastError.message }, 'Retrying Remnawave request');
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw new RemnawaveError(`All retries exhausted: ${lastError?.message}`);
  }
}
