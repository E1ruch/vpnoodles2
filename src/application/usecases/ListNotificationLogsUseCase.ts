import type { IUserRepository, INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { NotificationType } from '../../domain/entities/NotificationLog.js';
import { formatUserLabel } from '../../shared/utils/userLabel.js';

export interface NotificationLogEntry {
  id: string;
  userId: string;
  userLabel: string;
  type: NotificationType;
  delivered: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

export interface ListNotificationLogsResult {
  items: NotificationLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export class ListNotificationLogsUseCase {
  constructor(
    private notificationLogRepo: INotificationLogRepository,
    private userRepo: IUserRepository,
  ) {}

  async execute(params: { type?: NotificationType; page: number; pageSize: number }): Promise<ListNotificationLogsResult> {
    const skip = params.page * params.pageSize;

    const [logs, total] = await Promise.all([
      this.notificationLogRepo.findAll({
        type: params.type,
        skip,
        limit: params.pageSize,
        order: { createdAt: 'DESC' },
      }),
      this.notificationLogRepo.countAll({ type: params.type }),
    ]);

    const users = await this.userRepo.findByIds([...new Set(logs.map((log) => log.userId))]);
    const userById = new Map(users.map((user) => [user.id, user]));

    return {
      items: logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        userLabel: formatUserLabel(userById.get(log.userId), log.userId),
        type: log.type,
        delivered: log.delivered,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }
}
