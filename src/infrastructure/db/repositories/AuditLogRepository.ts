import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { AuditLog } from '../../../domain/entities/AuditLog.js';
import type { IAuditLogRepository } from '../../../domain/interfaces/repositories.js';

export class AuditLogRepository implements IAuditLogRepository {
  private getRepo(): Promise<Repository<AuditLog>> {
    return getDataSource().then((ds) => ds.getRepository(AuditLog));
  }

  async create(data: Partial<AuditLog>): Promise<AuditLog> {
    const repo = await this.getRepo();
    const log = repo.create(data);
    return repo.save(log);
  }

  async findByUserId(userId: string, limit: number): Promise<AuditLog[]> {
    const repo = await this.getRepo();
    return repo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
