import Redis from 'ioredis';
import { getEnv } from '../../shared/config/env.js';
import { getLogger } from '../../shared/logger/index.js';
import type { ICacheService } from '../../domain/interfaces/services.js';

export class RedisCacheService implements ICacheService {
  private client: Redis;

  constructor() {
    const env = getEnv();
    this.client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      getLogger().info('Redis connected');
    });

    this.client.on('error', (err) => {
      getLogger().error({ err }, 'Redis error');
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    if (data === null) return null;
    return JSON.parse(data) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    // SET key val EX ttl NX — атомарная операция на стороне Redis: либо мы ставим
    // ключ и получаем 'OK', либо ключ уже есть и мы получаем null. Раздельные
    // exists() + set() дают окно гонки между проверкой и записью — здесь его нет.
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.client.del(key);
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}
