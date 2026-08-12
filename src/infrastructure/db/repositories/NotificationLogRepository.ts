import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { NotificationLog } from '../../../domain/entities/NotificationLog.js';
import type { INotificationLogRepository } from '../../../domain/interfaces/repositories.js';

export class NotificationLogRepository implements INotificationLogRepository {
  private getRepo(): Promise<Repository<NotificationLog>> {
    return getDataSource().then((ds) => ds.getRepository(NotificationLog));
  }

  async create(data: Partial<NotificationLog>): Promise<NotificationLog> {
    const repo = await this.getRepo();
    const log = repo.create(data);
    return repo.save(log);
  }

  async exists(
    userId: string,
    type: NotificationLog['type'],
    options?: { entityId?: string | null; cycleKey?: string | null },
  ): Promise<boolean> {
    const repo = await this.getRepo();
    // Только успешно доставленные считаются «уже отправлено» — иначе транзиентный сбой
    // (таймаут, сетевой сбой, 429 от Telegram) навсегда блокирует повторную попытку
    // для этого пользователя/типа/цикла.
    const where: Record<string, unknown> = { userId, type, delivered: true };
    if (options?.entityId !== undefined) {
      where['entityId'] = options.entityId ?? null;
    }
    if (options?.cycleKey !== undefined) {
      where['cycleKey'] = options.cycleKey ?? null;
    }
    const count = await repo.count({ where });
    return count > 0;
  }

  async findByUserAndType(
    userId: string,
    type: NotificationLog['type'],
  ): Promise<NotificationLog[]> {
    const repo = await this.getRepo();
    return repo.find({ where: { userId, type }, order: { createdAt: 'DESC' } });
  }

  async countAll(options?: { type?: NotificationLog['type'] }): Promise<number> {
    const repo = await this.getRepo();
    return repo.count({ where: options?.type ? { type: options.type } : {} });
  }

  async findAll(options?: {
    limit?: number;
    skip?: number;
    order?: { [key: string]: 'ASC' | 'DESC' };
    type?: NotificationLog['type'];
  }): Promise<NotificationLog[]> {
    const repo = await this.getRepo();
    return repo.find({
      where: options?.type ? { type: options.type } : {},
      order: options?.order ?? { createdAt: 'DESC' },
      take: options?.limit,
      skip: options?.skip,
    });
  }

  async getStats(): Promise<{
    total: number;
    delivered: number;
    failed: number;
    byType: Array<{ type: NotificationLog['type']; total: number; delivered: number }>;
  }> {
    const repo = await this.getRepo();
    const rows = await repo
      .createQueryBuilder('n')
      .select(['n.type AS type', 'n.delivered AS delivered', 'COUNT(*)::int AS count'])
      .groupBy('n.type')
      .addGroupBy('n.delivered')
      .getRawMany<{ type: NotificationLog['type']; delivered: boolean; count: number }>();

    const byTypeMap = new Map<string, { type: NotificationLog['type']; total: number; delivered: number }>();
    let total = 0;
    let delivered = 0;

    for (const row of rows) {
      const count = Number(row.count) || 0;
      total += count;
      if (row.delivered) delivered += count;

      const existing = byTypeMap.get(row.type);
      if (existing) {
        existing.total += count;
        if (row.delivered) existing.delivered += count;
      } else {
        byTypeMap.set(row.type, {
          type: row.type,
          total: count,
          delivered: row.delivered ? count : 0,
        });
      }
    }

    return {
      total,
      delivered,
      failed: total - delivered,
      byType: [...byTypeMap.values()],
    };
  }
}
