import type { IReferralRewardRepository, IUserRepository } from '../../../domain/interfaces/repositories.js';
import { formatUserLabel } from '../../../shared/utils/userLabel.js';

export interface TopReferrerEntry {
  referrerUserId: string;
  userLabel: string;
  invitedCount: number;
  convertedCount: number;
  totalDaysGranted: number;
}

export class GetTopReferrersUseCase {
  constructor(
    private referralRewardRepo: IReferralRewardRepository,
    private userRepo: IUserRepository,
  ) {}

  async execute(limit: number): Promise<TopReferrerEntry[]> {
    const rows = await this.referralRewardRepo.getTopReferrers(limit);
    const users = await this.userRepo.findByIds(rows.map((row) => row.referrerUserId));
    const userById = new Map(users.map((user) => [user.id, user]));

    return rows.map((row) => ({
      referrerUserId: row.referrerUserId,
      userLabel: formatUserLabel(userById.get(row.referrerUserId), row.referrerUserId),
      invitedCount: row.invitedCount,
      convertedCount: row.convertedCount,
      totalDaysGranted: row.totalDaysGranted,
    }));
  }
}
