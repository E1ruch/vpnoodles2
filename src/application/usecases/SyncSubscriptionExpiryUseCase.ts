import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';

/**
 * Подтягивает expireAt из Remnawave (GET /api/users/{uuid}) и пишет в subscriptions.endDate.
 */
export class SyncSubscriptionExpiryUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(subscriptionId: string): Promise<void> {
    const logger = getLogger();
    const sub = await this.subscriptionRepo.findById(subscriptionId);
    if (!sub?.remnawaveUserId) return;

    try {
      const expireAt = await this.remnawaveService.getUserExpireAt(sub.remnawaveUserId);
      if (!expireAt) return;

      await this.subscriptionRepo.update(sub.id, { endDate: expireAt });
    } catch (err) {
      logger.warn({ err, subscriptionId }, 'Sync subscription endDate (expireAt) failed');
    }
  }
}
