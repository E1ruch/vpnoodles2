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

    if (user.hasUsedTrial) {
      throw new SubscriptionError('Trial already used');
    }

    const existingSub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (existingSub) {
      throw new SubscriptionError('User already has active subscription');
    }

    const trialPlans = await this.planRepo.findByType('trial');
    const trialPlan = trialPlans[0];
    if (!trialPlan) {
      throw new ValidationError('Trial plan not found');
    }

    // Create user in Remnawave with tag and squad
    const tag = trialPlan.remnawaveTag ?? 'TRIAL';
    const activeInternalSquads = env.REMNAWAVE_DEFAULT_SQUAD ? [env.REMNAWAVE_DEFAULT_SQUAD] : [];

    const remnawaveUserId = await this.remnawaveService.createUser(
      user.telegramId,
      user.username ?? `user_${user.telegramId}`,
      tag,
      activeInternalSquads,
    );

    const startDate = new Date();
    const endDate = daysFromNow(env.TRIAL_DURATION_DAYS);

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

    // Mark trial as used
    await this.userRepo.update(userId, { hasUsedTrial: true });

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
