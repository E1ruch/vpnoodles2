import type { IReferralRewardRepository, IUserRepository } from '../../../domain/interfaces/repositories.js';
import type { ReferralRewardType, ReferralRewardStatus } from '../../../domain/entities/ReferralReward.js';
import { formatUserLabel } from '../../../shared/utils/userLabel.js';

export interface ReferralRewardEntry {
  id: string;
  referrerUserId: string;
  referrerLabel: string;
  referredUserId: string;
  referredLabel: string;
  rewardType: ReferralRewardType;
  level: number;
  daysGranted: number;
  trafficGbGranted: number;
  status: ReferralRewardStatus;
  createdAt: Date;
}

export interface ListReferralRewardsResult {
  items: ReferralRewardEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** Пагинированная лента всех начислений — единая для /referrals (все) и для секции "Рефералы" в UserDetailPage (по одному пользователю). */
export class ListReferralRewardsUseCase {
  constructor(
    private referralRewardRepo: IReferralRewardRepository,
    private userRepo: IUserRepository,
  ) {}

  async execute(params: { page: number; pageSize: number; referrerUserId?: string }): Promise<ListReferralRewardsResult> {
    const skip = params.page * params.pageSize;

    const { items, total } = params.referrerUserId
      ? await this.referralRewardRepo.findByReferrer(params.referrerUserId, { skip, limit: params.pageSize })
      : await this.referralRewardRepo.findAll({ skip, limit: params.pageSize });

    const userIds = [...new Set(items.flatMap((item) => [item.referrerUserId, item.referredUserId]))];
    const users = await this.userRepo.findByIds(userIds);
    const userById = new Map(users.map((user) => [user.id, user]));

    return {
      items: items.map((item) => ({
        id: item.id,
        referrerUserId: item.referrerUserId,
        referrerLabel: formatUserLabel(userById.get(item.referrerUserId), item.referrerUserId),
        referredUserId: item.referredUserId,
        referredLabel: formatUserLabel(userById.get(item.referredUserId), item.referredUserId),
        rewardType: item.rewardType,
        level: item.level,
        daysGranted: item.daysGranted,
        trafficGbGranted: item.trafficGbGranted,
        status: item.status,
        createdAt: item.createdAt,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }
}
