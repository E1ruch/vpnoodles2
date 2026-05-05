import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import { getLogger } from '../../shared/logger/index.js';
import { ValidationError, SubscriptionError } from '../../shared/errors/index.js';
import { daysFromNow } from '../../shared/utils/index.js';

export class RenewSubscriptionUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private planRepo: IPlanRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(subscriptionId: string, additionalDays: number): Promise<{ endDate: Date }> {
    const logger = getLogger();

    const subscription = await this.subscriptionRepo.findById(subscriptionId);
    if (!subscription) {
      throw new ValidationError('Subscription not found');
    }

    if (subscription.status !== 'active' && subscription.status !== 'expired') {
      throw new SubscriptionError('Cannot renew subscription in current status');
    }

    const plan = await this.planRepo.findById(subscription.planId);
    if (!plan) throw new ValidationError('Plan not found');

    const currentEnd = subscription.endDate > new Date() ? subscription.endDate : new Date();
    const newEndDate = daysFromNow(additionalDays);

    await this.subscriptionRepo.update(subscriptionId, {
      status: 'active',
      endDate: newEndDate,
    });

    // Extend in Remnawave
    if (subscription.remnawaveUserId) {
      await this.remnawaveService.resumeUser(subscription.remnawaveUserId);
      await this.remnawaveService.extendUser(subscription.remnawaveUserId, additionalDays);
    }

    await this.auditLogRepo.create({
      userId: subscription.userId,
      action: 'subscription_renewed',
      entityType: 'subscription',
      entityId: subscriptionId,
      metadata: { additionalDays, newEndDate: newEndDate.toISOString() },
    });

    logger.info({ subscriptionId, additionalDays }, 'Subscription renewed');
    return { endDate: newEndDate };
  }
}
