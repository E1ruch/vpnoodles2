import type { IUserRepository, IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import { formatUserLabel } from '../../shared/utils/userLabel.js';

export interface AuditLogEntry {
  id: string;
  userId: string;
  userLabel: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ListAuditLogsResult {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export class ListAuditLogsUseCase {
  constructor(
    private auditLogRepo: IAuditLogRepository,
    private userRepo: IUserRepository,
  ) {}

  async execute(params: { page: number; pageSize: number }): Promise<ListAuditLogsResult> {
    const skip = params.page * params.pageSize;

    const [logs, total] = await Promise.all([
      this.auditLogRepo.findAll({ skip, limit: params.pageSize, order: { createdAt: 'DESC' } }),
      this.auditLogRepo.count(),
    ]);

    const users = await this.userRepo.findByIds([...new Set(logs.map((log) => log.userId))]);
    const userById = new Map(users.map((user) => [user.id, user]));

    return {
      items: logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        userLabel: formatUserLabel(userById.get(log.userId), log.userId),
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        createdAt: log.createdAt,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }
}
