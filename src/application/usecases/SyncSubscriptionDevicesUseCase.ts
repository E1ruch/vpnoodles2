import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';

/**
 * Подтягивает из Remnawave только total по HWID и пишет в subscriptions.usedDevices.
 */
export class SyncSubscriptionDevicesUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(subscriptionId: string): Promise<void> {
    const logger = getLogger();
    const sub = await this.subscriptionRepo.findById(subscriptionId);
    if (!sub?.remnawaveUserId) return;

    try {
      const total = await this.remnawaveService.getHwidDeviceTotal(sub.remnawaveUserId);
      await this.subscriptionRepo.update(sub.id, { usedDevices: total });
    } catch (err) {
      logger.warn({ err, subscriptionId }, 'Sync subscription usedDevices (HWID total) failed');
    }
  }
}
