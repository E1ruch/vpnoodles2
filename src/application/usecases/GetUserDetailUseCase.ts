import type {
  IUserRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
  IReferralRewardRepository,
} from '../../domain/interfaces/repositories.js';
import type { ReferralRewardType, ReferralRewardStatus } from '../../domain/entities/ReferralReward.js';
import type { SubscriptionStatus, PlanType } from '../../shared/types/index.js';
import { formatUserLabel } from '../../shared/utils/userLabel.js';

const RECENT_ACTIONS_LIMIT = 20;
const RECENT_REFERRAL_REWARDS_LIMIT = 20;

export interface UserDetailSubscription {
  id: string;
  planName: string;
  /** Тип тарифа ('paid' — трафик безлимитный по дизайну, см. PurchasePlanUseCase). null, если план не удалось разрешить. */
  planType: PlanType | null;
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

export interface UserDetailReferralReward {
  id: string;
  referrerUserId: string;
  referrerLabel: string;
  referredUserId: string;
  referredLabel: string;
  rewardType: ReferralRewardType;
  daysGranted: number;
  trafficGbGranted: number;
  status: ReferralRewardStatus;
  createdAt: Date;
}

export interface UserDetailReferral {
  referredByUserId: string | null;
  referredByLabel: string | null;
  invitedCount: number;
  rewards: UserDetailReferralReward[];
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
  referral: UserDetailReferral;
}

export class GetUserDetailUseCase {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
    private referralRewardRepo: IReferralRewardRepository,
  ) {}

  async execute(userId: string): Promise<UserDetail | null> {
    const user = await this.userRepo.findById(userId);
    if (!user) return null;

    const [subscriptions, payments, recentActions, invitedCount, referredBy, rewardsPage] = await Promise.all([
      this.subscriptionRepo.findByUserId(userId),
      this.paymentRepo.findByUserId(userId),
      this.auditLogRepo.findByUserId(userId, RECENT_ACTIONS_LIMIT),
      this.userRepo.countReferredBy(userId),
      user.referredByUserId ? this.userRepo.findById(user.referredByUserId) : Promise.resolve(null),
      this.referralRewardRepo.findByReferrer(userId, { limit: RECENT_REFERRAL_REWARDS_LIMIT }),
    ]);

    const rewardUserIds = [
      ...new Set(rewardsPage.items.flatMap((reward) => [reward.referrerUserId, reward.referredUserId])),
    ];
    const rewardUsers = await this.userRepo.findByIds(rewardUserIds);
    const rewardUserById = new Map(rewardUsers.map((u) => [u.id, u]));

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
      referral: {
        referredByUserId: user.referredByUserId,
        referredByLabel: user.referredByUserId
          ? formatUserLabel(referredBy, user.referredByUserId)
          : null,
        invitedCount,
        rewards: rewardsPage.items.map((reward) => ({
          id: reward.id,
          referrerUserId: reward.referrerUserId,
          referrerLabel: formatUserLabel(rewardUserById.get(reward.referrerUserId), reward.referrerUserId),
          referredUserId: reward.referredUserId,
          referredLabel: formatUserLabel(rewardUserById.get(reward.referredUserId), reward.referredUserId),
          rewardType: reward.rewardType,
          daysGranted: reward.daysGranted,
          trafficGbGranted: reward.trafficGbGranted,
          status: reward.status,
          createdAt: reward.createdAt,
        })),
      },
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription.id,
        planName: subscription.plan?.name ?? subscription.planId,
        planType: subscription.plan?.type ?? null,
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
