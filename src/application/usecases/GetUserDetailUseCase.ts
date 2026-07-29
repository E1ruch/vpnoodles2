import type {
  IUserRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
} from '../../domain/interfaces/repositories.js';
import type { SubscriptionStatus } from '../../shared/types/index.js';

const RECENT_ACTIONS_LIMIT = 20;

export interface UserDetailSubscription {
  id: string;
  planName: string;
  status: SubscriptionStatus;
  startDate: Date;
  endDate: Date;
  deviceLimit: number;
  usedDevices: number;
  isActive: boolean;
}

export interface UserDetailPayment {
  id: string;
  planLabel: string;
  amount: number;
  currency: string | null;
  provider: string;
  status: string;
  createdAt: Date;
}

export interface UserDetailAction {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
}

export interface UserDetail {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isActive: boolean;
  hasUsedTrial: boolean;
  createdAt: Date;
  subscriptions: UserDetailSubscription[];
  payments: UserDetailPayment[];
  recentActions: UserDetailAction[];
}

export class GetUserDetailUseCase {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
  ) {}

  async execute(userId: string): Promise<UserDetail | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;

    const [subscriptions, payments, recentActions] = await Promise.all([
      this.subscriptionRepo.findByUserId(userId),
      this.paymentRepo.findByUserId(userId),
      this.auditLogRepo.findByUserId(userId, RECENT_ACTIONS_LIMIT),
    ]);

    return {
      id: user.id,
      telegramId: user.telegramId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      languageCode: user.languageCode,
      isActive: user.isActive,
      hasUsedTrial: user.hasUsedTrial,
      createdAt: user.createdAt,
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription.id,
        planName: subscription.plan?.name ?? subscription.planId,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        deviceLimit: subscription.deviceLimit,
        usedDevices: subscription.usedDevices,
        isActive: subscription.isActive,
      })),
      payments: payments.map((payment) => ({
        id: payment.id,
        planLabel: payment.plan?.name ?? payment.planId,
        amount: payment.amount,
        currency: payment.currency,
        provider: payment.provider,
        status: payment.status,
        createdAt: payment.createdAt,
      })),
      recentActions: recentActions.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        createdAt: log.createdAt,
      })),
    };
  }
}
