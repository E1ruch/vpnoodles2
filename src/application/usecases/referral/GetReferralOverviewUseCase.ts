import type { IReferralRewardRepository, ReferralRewardStats } from '../../../domain/interfaces/repositories.js';

/** Тонкая обёртка над репозиторием для симметрии с GetAdminOverviewUseCase — единая точка правды для KPI на /referrals. */
export class GetReferralOverviewUseCase {
  constructor(private referralRewardRepo: IReferralRewardRepository) {}

  async execute(): Promise<ReferralRewardStats> {
    return this.referralRewardRepo.getStats();
  }
}
