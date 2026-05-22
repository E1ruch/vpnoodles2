import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import { getLogger } from '../../shared/logger/index.js';
import { ValidationError, SubscriptionError, RemnawaveError } from '../../shared/errors/index.js';
import type { SyncSubscriptionExpiryUseCase } from './SyncSubscriptionExpiryUseCase.js';

export class RenewSubscriptionUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private planRepo: IPlanRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
    private syncSubscriptionExpiry: SyncSubscriptionExpiryUseCase,
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
    const estimatedEndDate = new Date(currentEnd);
    estimatedEndDate.setDate(estimatedEndDate.getDate() + additionalDays);

    await this.subscriptionRepo.update(subscriptionId, {
      status: 'active',
      endDate: estimatedEndDate,
    });

    // Extend in Remnawave and update tag
    if (subscription.remnawaveUserId) {
      try {
        await this.remnawaveService.resumeUser(subscription.remnawaveUserId);
        await this.remnawaveService.extendUser(subscription.remnawaveUserId, additionalDays);
        const newTag = plan.remnawaveTag ?? 'PAID';
        await this.remnawaveService.updateUserTag(subscription.remnawaveUserId, newTag);
      } catch (error) {
        const isMissingUserError =
          error instanceof RemnawaveError &&
          (error.message.includes('404') || error.message.includes('A063'));

        if (!isMissingUserError) {
          throw error;
        }
        throw new RemnawaveError(
          `Remnawave user is missing for subscription ${subscriptionId}. Manual resync required.`,
        );
      }

      await this.syncSubscriptionExpiry.execute(subscriptionId);
    }

    const updated = await this.subscriptionRepo.findById(subscriptionId);
    const endDate = updated?.endDate ?? estimatedEndDate;

    await this.auditLogRepo.create({
      userId: subscription.userId,
      action: 'subscription_renewed',
      entityType: 'subscription',
      entityId: subscriptionId,
      metadata: { additionalDays, newEndDate: endDate.toISOString() },
    });

    logger.info({ subscriptionId, additionalDays }, 'Subscription renewed');
    return { endDate };
  }
}
