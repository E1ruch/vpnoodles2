import type {
  IUserRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
  INotificationLogRepository,
  RevenueSummary,
} from '../../domain/interfaces/repositories.js';
import type { NotificationType } from '../../domain/entities/NotificationLog.js';

const RECENT_PAYMENTS_LIMIT = 10;

export interface AdminOverviewPaymentEntry {
  id: string;
  userLabel: string;
  planLabel: string;
  amount: number;
  currency: string | null;
  provider: string;
  status: string;
  createdAt: Date;
}

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
  recentPayments: AdminOverviewPaymentEntry[];
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
    const [users, subscriptions, logsCount, revenue, notifications, payments] = await Promise.all([
      this.userRepo.findAll(),
      this.subscriptionRepo.findAll(),
      this.auditLogRepo.count(),
      this.paymentRepo.getRevenueSummary(),
      this.notificationLogRepo.getStats(),
      this.paymentRepo.findAll(),
    ]);

    const recentPayments: AdminOverviewPaymentEntry[] = payments.slice(0, RECENT_PAYMENTS_LIMIT).map((payment) => ({
      id: payment.id,
      userLabel: payment.user?.username
        ? `@${payment.user.username}`
        : (payment.user?.firstName ?? payment.userId),
      planLabel: payment.plan?.name ?? payment.planId,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      status: payment.status,
      createdAt: payment.createdAt,
    }));

    return {
      usersCount: users.length,
      activeUsersCount: users.filter((user) => user.isActive).length,
      subscriptionsCount: subscriptions.length,
      activeSubscriptionsCount: subscriptions.filter((subscription) => subscription.isActive).length,
      paymentsCount: payments.length,
      logsCount,
      revenue,
      notifications,
      recentPayments,
    };
  }
}
