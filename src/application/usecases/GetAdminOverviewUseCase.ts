import type {
  IUserRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
  INotificationLogRepository,
  RevenueSummary,
} from '../../domain/interfaces/repositories.js';
import type { NotificationType } from '../../domain/entities/NotificationLog.js';

export interface AdminOverview {
  usersCount: number;
  activeUsersCount: number;
  subscriptionsCount: number;
  activeSubscriptionsCount: number;
  paymentsCount: number;
  logsCount: number;
  revenue: RevenueSummary;
  notifications: {
    total: number;
    delivered: number;
    failed: number;
    byType: Array<{ type: NotificationType; total: number; delivered: number }>;
  };
}

/**
 * Агрегированная сводка для дашборда веб-админки (и, потенциально, для
 * admin_stats в Telegram-боте) — единая точка правды вместо дублирования
 * count()-вызовов в нескольких местах.
 */
export class GetAdminOverviewUseCase {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
    private notificationLogRepo: INotificationLogRepository,
  ) {}

  async execute(): Promise<AdminOverview> {
    const [users, subscriptions, logsCount, revenue, notifications, paymentsCount] = await Promise.all([
      this.userRepo.findAll(),
      this.subscriptionRepo.findAll(),
      this.auditLogRepo.count(),
      this.paymentRepo.getRevenueSummary(),
      this.notificationLogRepo.getStats(),
      this.paymentRepo.count(),
    ]);

    return {
      usersCount: users.length,
      activeUsersCount: users.filter((user) => user.isActive).length,
      subscriptionsCount: subscriptions.length,
      activeSubscriptionsCount: subscriptions.filter((subscription) => subscription.isActive).length,
      paymentsCount,
      logsCount,
      revenue,
      notifications,
    };
  }
}
