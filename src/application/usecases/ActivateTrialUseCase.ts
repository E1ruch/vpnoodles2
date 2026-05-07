import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';
import { SubscriptionError, ValidationError } from '../../shared/errors/index.js';
import { daysFromNow } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';

export class ActivateTrialUseCase {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(userId: string): Promise<{ subscriptionId: string; subscriptionUrl: string }> {
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

    // Конвертируем ГБ в байты (1 ГБ = 1024^3 байт)
    const trafficLimitBytes = env.TRIAL_TRAFFIC_LIMIT_GB * 1024 * 1024 * 1024;
    const trafficLimitStrategy = env.TRIAL_TRAFFIC_STRATEGY;
    const expireAt = daysFromNow(env.TRIAL_DURATION_DAYS);

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
    return { subscriptionId: subscription.id, subscriptionUrl };
  }
}
