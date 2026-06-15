import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';

/**
 * Зеркалит expireAt и status из Remnawave (GET /api/users/{uuid}) в subscriptions.
 * Remnawave — источник истины, БД только для бота.
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
      const state = await this.remnawaveService.getUserSubscriptionState(sub.remnawaveUserId);
      if (!state) return;

      await this.subscriptionRepo.update(sub.id, {
        endDate: state.expireAt,
        status: state.status,
      });
    } catch (err) {
      logger.warn({ err, subscriptionId }, 'Sync subscription state from Remnawave failed');
    }
  }
}
