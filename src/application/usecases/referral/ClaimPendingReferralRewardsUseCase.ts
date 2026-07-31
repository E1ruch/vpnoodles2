import type { IReferralRewardRepository } from '../../../domain/interfaces/repositories.js';
import type { RenewSubscriptionUseCase } from '../RenewSubscriptionUseCase.js';
import { ReferralSettingsService } from './ReferralSettingsService.js';
import { getLogger } from '../../../shared/logger/index.js';

/**
 * §2.7 плана: применяет "банкованные" (status='pending_claim') реферальные награды
 * пользователя к только что созданной/активированной подписке (trial или платной) —
 * тот самый "get back" hook, вызываемый из ActivateTrialUseCase и PurchasePlanUseCase.
 * Считает pending-строки не по типу награды, а суммарно по всем — банк один на пользователя.
 */
export class ClaimPendingReferralRewardsUseCase {
  constructor(
    private rewardRepo: IReferralRewardRepository,
    private renewSubscriptionUseCase: RenewSubscriptionUseCase,
    private referralSettings: ReferralSettingsService,
  ) {}

  async execute(userId: string, subscriptionId: string): Promise<void> {
    const logger = getLogger();

    // §7.4: пока рубильник выключен, банк не выплачивается и не сгорает — просто ждёт.
    const settings = await this.referralSettings.get();
    if (!settings.enabled) return;

    const pending = await this.rewardRepo.findPendingByReferrer(userId);
    if (pending.length === 0) return;

    const totalDays = pending.reduce((sum, reward) => sum + reward.daysGranted, 0);
    const ids = pending.map((reward) => reward.id);

    if (totalDays <= 0) {
      await this.rewardRepo.markClaimed(ids, subscriptionId);
      return;
    }

    try {
      await this.renewSubscriptionUseCase.execute(subscriptionId, totalDays);
      await this.rewardRepo.markClaimed(ids, subscriptionId);
      logger.info({ userId, subscriptionId, totalDays, count: ids.length }, 'Pending referral rewards claimed');
    } catch (err) {
      logger.error({ err, userId, subscriptionId }, 'Failed to claim pending referral rewards');
    }
  }
}
