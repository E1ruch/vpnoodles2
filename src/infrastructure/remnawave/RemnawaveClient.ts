import { getLogger } from '../../shared/logger/index.js';
import { RemnawaveError } from '../../shared/errors/index.js';
import { getEnv } from '../../shared/config/env.js';
import { sleep } from '../../shared/utils/index.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';

interface RemnawaveUser {
  id: string;
  username: string;
  status: string;
  subscriptionUrl?: string;
  deviceLimit: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
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

  async createUser(telegramId: number, username: string): Promise<string> {
    const logger = getLogger();
    logger.info({ telegramId, username }, 'Creating Remnawave user');

    return this.withRetry(async () => {
      const response = await this.request<ApiResponse<RemnawaveUser>>('POST', '/api/users', {
        username: `tg_${telegramId}`,
        telegramId,
        displayName: username || `User ${telegramId}`,
      });

      if (!response.success) {
        throw new RemnawaveError(`Failed to create user: ${response.error}`);
      }

      logger.info({ remnawaveUserId: response.data.id }, 'Remnawave user created');
      return response.data.id;
    });
  }

  async deleteUser(remnawaveUserId: string): Promise<void> {
    await this.withRetry(async () => {
      const response = await this.request<ApiResponse<void>>(
        'DELETE',
        `/api/users/${remnawaveUserId}`,
      );
      if (!response.success) {
        throw new RemnawaveError(`Failed to delete user: ${response.error}`);
      }
    });
  }

  async suspendUser(remnawaveUserId: string): Promise<void> {
    await this.withRetry(async () => {
      const response = await this.request<ApiResponse<void>>(
        'POST',
        `/api/users/${remnawaveUserId}/suspend`,
      );
      if (!response.success) {
        throw new RemnawaveError(`Failed to suspend user: ${response.error}`);
      }
    });
  }

  async resumeUser(remnawaveUserId: string): Promise<void> {
    await this.withRetry(async () => {
      const response = await this.request<ApiResponse<void>>(
        'POST',
        `/api/users/${remnawaveUserId}/resume`,
      );
      if (!response.success) {
        throw new RemnawaveError(`Failed to resume user: ${response.error}`);
      }
    });
  }

  async getSubscriptionUrl(remnawaveUserId: string): Promise<string> {
    return this.withRetry(async () => {
      const response = await this.request<ApiResponse<RemnawaveUser>>(
        'GET',
        `/api/users/${remnawaveUserId}`,
      );
      if (!response.success || !response.data.subscriptionUrl) {
        throw new RemnawaveError(`Failed to get subscription URL: ${response.error}`);
      }
      return response.data.subscriptionUrl;
    });
  }

  async updateDeviceLimit(remnawaveUserId: string, limit: number): Promise<void> {
    await this.withRetry(async () => {
      const response = await this.request<ApiResponse<void>>(
        'PATCH',
        `/api/users/${remnawaveUserId}`,
        {
          deviceLimit: limit,
        },
      );
      if (!response.success) {
        throw new RemnawaveError(`Failed to update device limit: ${response.error}`);
      }
    });
  }

  async extendUser(remnawaveUserId: string, days: number): Promise<void> {
    await this.withRetry(async () => {
      const response = await this.request<ApiResponse<void>>(
        'POST',
        `/api/users/${remnawaveUserId}/extend`,
        {
          days,
        },
      );
      if (!response.success) {
        throw new RemnawaveError(`Failed to extend user: ${response.error}`);
      }
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
      const data = (await res.json()) as T;

      if (!res.ok) {
        logger.error({ status: res.status, path }, 'Remnawave API error');
        throw new RemnawaveError(`API error ${res.status} on ${path}`);
      }

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
