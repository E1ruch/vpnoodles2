import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { SyncSubscriptionDevicesUseCase } from './SyncSubscriptionDevicesUseCase.js';
import type { ReferralRewardService } from './referral/ReferralRewardService.js';
import type { ClaimPendingReferralRewardsUseCase } from './referral/ClaimPendingReferralRewardsUseCase.js';
import { getLogger } from '../../shared/logger/index.js';
import { SubscriptionError, ValidationError } from '../../shared/errors/index.js';
import { daysFromNow } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';

const GB_IN_BYTES = 1024 * 1024 * 1024;

export class ActivateTrialUseCase {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
    private syncSubscriptionDevices: SyncSubscriptionDevicesUseCase,
    private referralRewardService: ReferralRewardService,
    private claimPendingReferralRewards: ClaimPendingReferralRewardsUseCase,
  ) {}

  async execute(userId: string): Promise<{
    subscriptionId: string;
    subscriptionUrl: string;
    referralPerkApplied: { days: number; trafficGb: number } | null;
  }> {
    const logger = getLogger();
    const env = getEnv();

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new ValidationError('User not found');
    }

    const trialPlans = await this.planRepo.findByType('trial');
    const trialPlan = trialPlans[0];
    if (!trialPlan) {
      throw new ValidationError('Trial plan not found');
    }

    // Не даем создавать дубликат trial-подписки:
    // если trial уже существует (даже истекший), пользователь должен использовать продление.
    const userSubscriptions = await this.subscriptionRepo.findByUserId(userId);
    const existingTrial = userSubscriptions.find((sub) => sub.planId === trialPlan.id);
    if (existingTrial) {
      throw new SubscriptionError('Trial subscription already exists. Use renew');
    }

    // Проверяем наличие активной подписки
    const existingSub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (existingSub) {
      throw new SubscriptionError('User already has active subscription');
    }

    // Create user in Remnawave with tag and squad
    const tag = trialPlan.remnawaveTag ?? 'TRIAL';
    const activeInternalSquads = env.REMNAWAVE_DEFAULT_SQUAD ? [env.REMNAWAVE_DEFAULT_SQUAD] : [];

    // Реферальная программа (§2.1, §5.3): бонус самому приглашённому применяется прямо к
    // создаваемому trial — это дешевле, чем отдельный round-trip в Remnawave после создания.
    // Best-effort: сбой здесь не должен блокировать активацию trial.
    let referralPerkAdjustment: { extraDays: number; extraTrafficGb: number } | null = null;
    try {
      referralPerkAdjustment = await this.referralRewardService.getReferredSignupPerkAdjustment(
        user.referredByUserId,
      );
    } catch (err) {
      logger.error({ err, userId }, 'Failed to compute referral signup perk adjustment');
    }

    // Конвертируем ГБ в байты (1 ГБ = 1024^3 байт)
    const trafficLimitBytes =
      env.TRIAL_TRAFFIC_LIMIT_GB * 1024 * 1024 * 1024 +
      (referralPerkAdjustment?.extraTrafficGb ?? 0) * GB_IN_BYTES;
    const trafficLimitStrategy = env.TRIAL_TRAFFIC_STRATEGY;
    const expireAt = daysFromNow(env.TRIAL_DURATION_DAYS + (referralPerkAdjustment?.extraDays ?? 0));

    const remnawaveUserId = await this.remnawaveService.createUser(
      user.telegramId,
      user.username ?? `user_${user.telegramId}`,
      tag,
      activeInternalSquads,
      {
        trafficLimitBytes,
        trafficLimitStrategy,
        expireAt,
        deviceLimit: trialPlan.deviceLimit,
      },
    );

    const startDate = new Date();
    const endDate = expireAt;

    const subscription = await this.subscriptionRepo.create({
      userId,
      planId: trialPlan.id,
      status: 'active',
      startDate,
      endDate,
      deviceLimit: env.TRIAL_DEVICE_LIMIT,
      remnawaveUserId,
    });

    // Get subscription URL from Remnawave
    const subscriptionUrl = await this.remnawaveService.getSubscriptionUrl(remnawaveUserId);

    // Update subscription with URL
    await this.subscriptionRepo.update(subscription.id, { subscriptionUrl });

    await this.syncSubscriptionDevices.execute(subscription.id);

    // Реферальная программа (§5.3), полностью best-effort — сбой любого из шагов не должен
    // сказаться на уже успешно выданном trial.
    try {
      if (referralPerkAdjustment) {
        await this.referralRewardService.recordReferredSignupPerk(
          user,
          subscription.id,
          referralPerkAdjustment,
        );
      }
      await this.claimPendingReferralRewards.execute(userId, subscription.id);
      await this.referralRewardService.grantReferrerSignupReward(user);
    } catch (err) {
      logger.error({ err, userId, subscriptionId: subscription.id }, 'Referral reward processing failed');
    }

    // НЕ отмечаем hasUsedTrial - бесплатный тариф можно продлевать
    // await this.userRepo.update(userId, { hasUsedTrial: true });

    await this.auditLogRepo.create({
      userId,
      action: 'trial_activated',
      entityType: 'subscription',
      entityId: subscription.id,
      metadata: { planId: trialPlan.id, remnawaveUserId },
    });

    logger.info({ userId, subscriptionId: subscription.id }, 'Trial activated');
    return {
      subscriptionId: subscription.id,
      subscriptionUrl,
      referralPerkApplied: referralPerkAdjustment
        ? { days: referralPerkAdjustment.extraDays, trafficGb: referralPerkAdjustment.extraTrafficGb }
        : null,
    };
  }
}
