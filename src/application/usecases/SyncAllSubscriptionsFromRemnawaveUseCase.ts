import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { Subscription } from '../../domain/entities/Subscription.js';
import { getLogger } from '../../shared/logger/index.js';
import { sleep } from '../../shared/utils/index.js';
import type { SyncSubscriptionDevicesUseCase } from './SyncSubscriptionDevicesUseCase.js';
import type { SyncSubscriptionExpiryUseCase } from './SyncSubscriptionExpiryUseCase.js';

const SYNC_DELAY_MS = 30;

export interface SyncAllFromRemnawaveResult {
  totalSubscriptions: number;
  remnawaveUsers: number;
  updatedSubscriptions: number;
  syncedRemnawaveUsers: number;
  failedRemnawaveUsers: number;
  skippedNoRemnawave: number;
}

export class SyncAllSubscriptionsFromRemnawaveUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private remnawaveService: IRemnawaveService,
    private syncSubscriptionExpiry: SyncSubscriptionExpiryUseCase,
    private syncSubscriptionDevices: SyncSubscriptionDevicesUseCase,
  ) {}

  async execute(): Promise<SyncAllFromRemnawaveResult> {
    const logger = getLogger();
    const subscriptions = await this.subscriptionRepo.findAll();
    const groups = this.groupByRemnawaveUserId(subscriptions);

    let updatedSubscriptions = 0;
    let syncedRemnawaveUsers = 0;
    let failedRemnawaveUsers = 0;

    for (const [remnawaveUserId, subs] of groups) {
      try {
        const state = await this.remnawaveService.getUserSubscriptionState(remnawaveUserId);
        if (!state) {
          failedRemnawaveUsers++;
          continue;
        }

        let subscriptionUrl: string | null = null;
        try {
          subscriptionUrl = await this.remnawaveService.getSubscriptionUrl(remnawaveUserId);
        } catch (err) {
          logger.warn({ err, remnawaveUserId }, 'Sync subscription URL failed');
        }

        for (const sub of subs) {
          await this.syncSubscriptionExpiry.execute(sub.id);
          await this.syncSubscriptionDevices.execute(sub.id);
          if (subscriptionUrl) {
            await this.subscriptionRepo.update(sub.id, { subscriptionUrl });
          }
          updatedSubscriptions++;
        }

        syncedRemnawaveUsers++;
      } catch (err) {
        failedRemnawaveUsers++;
        logger.warn({ err, remnawaveUserId }, 'Sync Remnawave user to DB failed');
      }

      await sleep(SYNC_DELAY_MS);
    }

    logger.info(
      {
        totalSubscriptions: subscriptions.length,
        syncedRemnawaveUsers,
        failedRemnawaveUsers,
        updatedSubscriptions,
      },
      'Bulk sync from Remnawave completed',
    );

    return {
      totalSubscriptions: subscriptions.length,
      remnawaveUsers: groups.size,
      updatedSubscriptions,
      syncedRemnawaveUsers,
      failedRemnawaveUsers,
      skippedNoRemnawave: this.countWithoutRemnawave(subscriptions),
    };
  }

  private groupByRemnawaveUserId(subscriptions: Subscription[]): Map<string, Subscription[]> {
    const groups = new Map<string, Subscription[]>();

    for (const sub of subscriptions) {
      if (!sub.remnawaveUserId) continue;
      const list = groups.get(sub.remnawaveUserId) ?? [];
      list.push(sub);
      groups.set(sub.remnawaveUserId, list);
    }

    return groups;
  }

  private countWithoutRemnawave(subscriptions: Subscription[]): number {
    return subscriptions.filter((sub) => !sub.remnawaveUserId).length;
  }
}
