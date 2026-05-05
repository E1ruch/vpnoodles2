import { getLogger } from '../../shared/logger/index.js';
import { RemnawaveError } from '../../shared/errors/index.js';
import { getEnv } from '../../shared/config/env.js';
import { sleep } from '../../shared/utils/index.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';

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
  activeInternalSquads: string[];
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

interface RemnawaveUpdateUserPayload {
  username?: string;
  status?: string;
  trafficLimitBytes?: number;
  trafficLimitStrategy?: string;
  expireAt?: string;
  description?: string;
  tag?: string;
  telegramId?: number | null;
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
      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>('GET', `/api/users/by-username/${username}`);
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
    },
  ): Promise<string> {
    const logger = getLogger();
    // PostgreSQL bigint может возвращать строку, поэтому принудительно конвертируем в число
    const numericTelegramId = Number(telegramId);
    logger.info({ telegramId: numericTelegramId, username, tag, activeInternalSquads, options }, 'Creating Remnawave user');

    return this.withRetry(async () => {
      // Сначала проверяем, существует ли уже пользователь с таким username
      const existingUuid = await this.findUserByUsername(`tg_${numericTelegramId}`);
      if (existingUuid) {
        logger.info({ remnawaveUserId: existingUuid }, 'Remnawave user already exists, returning existing UUID');
        return existingUuid;
      }

      const payload: RemnawaveCreateUserPayload = {
        username: `tg_${numericTelegramId}`,
        status: 'ACTIVE',
        trafficLimitBytes: options?.trafficLimitBytes ?? 0,
        trafficLimitStrategy: options?.trafficLimitStrategy ?? 'NO_RESET',
        expireAt: options?.expireAt?.toISOString() ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        telegramId: numericTelegramId,
        hwidDeviceLimit: 1,
        description: `Telegram user: ${username || numericTelegramId}`,
        tag,
        activeInternalSquads,
      };

      const response = await this.request<RemnawaveUser>('POST', '/api/users', payload);

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
      const payload: RemnawaveUpdateUserPayload = {
        status: 'DISABLED',
      };
      await this.request<RemnawaveUser>('PATCH', `/api/users/${remnawaveUserId}`, payload);
      logger.info({ remnawaveUserId }, 'Remnawave user suspended');
    });
  }

  async resumeUser(remnawaveUserId: string): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId }, 'Resuming Remnawave user');

    await this.withRetry(async () => {
      const payload: RemnawaveUpdateUserPayload = {
        status: 'ACTIVE',
      };
      await this.request<RemnawaveUser>('PATCH', `/api/users/${remnawaveUserId}`, payload);
      logger.info({ remnawaveUserId }, 'Remnawave user resumed');
    });
  }

  async getSubscriptionUrl(remnawaveUserId: string): Promise<string> {
    const logger = getLogger();
    logger.info({ remnawaveUserId }, 'Getting subscription URL');

    return this.withRetry(async () => {
      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>('GET', `/api/users/${remnawaveUserId}`);
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
      const payload: RemnawaveUpdateUserPayload = {
        hwidDeviceLimit: limit,
      };
      await this.request<RemnawaveUser>('PATCH', `/api/users/${remnawaveUserId}`, payload);
      logger.info({ remnawaveUserId, limit }, 'Device limit updated');
    });
  }

  async updateUserTag(remnawaveUserId: string, tag: string): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId, tag }, 'Updating user tag');

    await this.withRetry(async () => {
      const payload: RemnawaveUpdateUserPayload = {
        tag,
      };
      await this.request<RemnawaveUser>('PATCH', `/api/users/${remnawaveUserId}`, payload);
      logger.info({ remnawaveUserId, tag }, 'User tag updated');
    });
  }

  async extendUser(remnawaveUserId: string, days: number): Promise<void> {
    const logger = getLogger();
    logger.info({ remnawaveUserId, days }, 'Extending user subscription');

    await this.withRetry(async () => {
      // First get current user to read expireAt
      const raw = await this.request<RemnawaveApiResponse<RemnawaveUser>>('GET', `/api/users/${remnawaveUserId}`);
      const currentUser = raw.response;

      const currentExpiry = new Date(currentUser.expireAt);
      const newExpiry = new Date(
        Math.max(currentExpiry.getTime(), Date.now()) + days * 24 * 60 * 60 * 1000,
      );

      const payload: RemnawaveUpdateUserPayload = {
        expireAt: newExpiry.toISOString(),
      };
      await this.request<RemnawaveUser>('PATCH', `/api/users/${remnawaveUserId}`, payload);
      logger.info(
        { remnawaveUserId, days, newExpiry: newExpiry.toISOString() },
        'User subscription extended',
      );
    });
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
