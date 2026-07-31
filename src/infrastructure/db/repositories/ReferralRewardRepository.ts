import { In, Repository, type QueryDeepPartialEntity } from 'typeorm';
import { getDataSource } from '../connection.js';
import { ReferralReward, type ReferralRewardType } from '../../../domain/entities/ReferralReward.js';
import type {
  IReferralRewardRepository,
  Paginated,
  ReferralRewardStats,
  ReferralTopReferrerRow,
} from '../../../domain/interfaces/repositories.js';

export class ReferralRewardRepository implements IReferralRewardRepository {
  private getRepo(): Promise<Repository<ReferralReward>> {
    return getDataSource().then((ds) => ds.getRepository(ReferralReward));
  }

  async create(data: Partial<ReferralReward>): Promise<ReferralReward> {
    const repo = await this.getRepo();
    const reward = repo.create(data);
    return repo.save(reward);
  }

  async update(id: string, data: Partial<ReferralReward>): Promise<void> {
    const repo = await this.getRepo();
    await repo.update(id, data as QueryDeepPartialEntity<ReferralReward>);
  }

  async countCompletedConversionsSince(referrerUserId: string, since: Date): Promise<number> {
    const repo = await this.getRepo();
    return repo
      .createQueryBuilder('r')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.rewardType = :rewardType', { rewardType: 'referrer_conversion_l1_days' })
      .andWhere('r.status = :status', { status: 'granted' })
      .andWhere('r.createdAt >= :since', { since })
      .getCount();
  }

  async countRewardsSince(
    referrerUserId: string,
    rewardType: ReferralRewardType,
    since: Date,
  ): Promise<number> {
    const repo = await this.getRepo();
    return repo
      .createQueryBuilder('r')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.rewardType = :rewardType', { rewardType })
      .andWhere('r.createdAt >= :since', { since })
      .getCount();
  }

  async sumPendingDays(referrerUserId: string): Promise<number> {
    const repo = await this.getRepo();
    const row = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.daysGranted), 0)', 'sum')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.status = :status', { status: 'pending_claim' })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  async sumGrantedTrafficGb(referrerUserId: string, rewardType: ReferralRewardType): Promise<number> {
    const repo = await this.getRepo();
    const row = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.trafficGbGranted), 0)', 'sum')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.rewardType = :rewardType', { rewardType })
      .andWhere('r.status = :status', { status: 'granted' })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  async sumPendingDaysTotal(): Promise<number> {
    const repo = await this.getRepo();
    const row = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.daysGranted), 0)', 'sum')
      .where('r.status = :status', { status: 'pending_claim' })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  async sumGrantedDaysTotal(referrerUserId: string): Promise<number> {
    const repo = await this.getRepo();
    const row = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.daysGranted), 0)', 'sum')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.status = :status', { status: 'granted' })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  async sumGrantedTrafficGbTotal(referrerUserId: string): Promise<number> {
    const repo = await this.getRepo();
    const row = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.trafficGbGranted), 0)', 'sum')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.status = :status', { status: 'granted' })
      .getRawOne<{ sum: string }>();
    return Number(row?.sum ?? 0);
  }

  async findPendingByReferrer(referrerUserId: string): Promise<ReferralReward[]> {
    const repo = await this.getRepo();
    return repo.find({
      where: { referrerUserId, status: 'pending_claim' },
      order: { createdAt: 'ASC' },
    });
  }

  async markClaimed(ids: string[], creditedSubscriptionId: string): Promise<void> {
    if (ids.length === 0) return;
    const repo = await this.getRepo();
    await repo.update(
      { id: In(ids) },
      { status: 'granted', creditedSubscriptionId, claimedAt: new Date() },
    );
  }

  async countConvertedReferrals(referrerUserId: string): Promise<number> {
    const repo = await this.getRepo();
    const row = await repo
      .createQueryBuilder('r')
      .select('COUNT(DISTINCT r.referredUserId)', 'count')
      .where('r.referrerUserId = :referrerUserId', { referrerUserId })
      .andWhere('r.rewardType = :rewardType', { rewardType: 'referrer_conversion_l1_days' })
      .andWhere('r.status IN (:...statuses)', { statuses: ['granted', 'pending_claim', 'capped'] })
      .getRawOne<{ count: string }>();
    return Number(row?.count ?? 0);
  }

  async findByReferrer(
    referrerUserId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Paginated<ReferralReward>> {
    const repo = await this.getRepo();
    const [items, total] = await repo.findAndCount({
      where: [{ referrerUserId }, { referredUserId: referrerUserId }],
      order: { createdAt: 'DESC' },
      take: options?.limit,
      skip: options?.skip,
    });
    return { items, total };
  }

  async findAll(options?: { limit?: number; skip?: number }): Promise<Paginated<ReferralReward>> {
    const repo = await this.getRepo();
    const [items, total] = await repo.findAndCount({
      order: { createdAt: 'DESC' },
      take: options?.limit,
      skip: options?.skip,
    });
    return { items, total };
  }

  async getTopReferrers(limit: number): Promise<ReferralTopReferrerRow[]> {
    const repo = await this.getRepo();
    const rows = await repo
      .createQueryBuilder('r')
      .select('r.referrerUserId', 'referrerUserId')
      .addSelect('COUNT(DISTINCT r.referredUserId)', 'invitedCount')
      .addSelect(
        `COUNT(DISTINCT CASE WHEN r.rewardType = :convType THEN r.referredUserId END)`,
        'convertedCount',
      )
      .addSelect('COALESCE(SUM(r.daysGranted), 0)', 'totalDaysGranted')
      .where('r.status IN (:...statuses)', { statuses: ['granted', 'pending_claim', 'capped'] })
      .setParameter('convType', 'referrer_conversion_l1_days')
      .groupBy('r.referrerUserId')
      .orderBy('"convertedCount"', 'DESC')
      .limit(limit)
      .getRawMany<{
        referrerUserId: string;
        invitedCount: string;
        convertedCount: string;
        totalDaysGranted: string;
      }>();

    return rows.map((row) => ({
      referrerUserId: row.referrerUserId,
      invitedCount: Number(row.invitedCount),
      convertedCount: Number(row.convertedCount),
      totalDaysGranted: Number(row.totalDaysGranted),
    }));
  }

  async getStats(): Promise<ReferralRewardStats> {
    const repo = await this.getRepo();

    const totalReferred = await repo
      .createQueryBuilder('r')
      .select('COUNT(DISTINCT r.referredUserId)', 'count')
      .getRawOne<{ count: string }>();

    const totalConverted = await repo
      .createQueryBuilder('r')
      .select('COUNT(DISTINCT r.referredUserId)', 'count')
      .where('r.rewardType = :rewardType', { rewardType: 'referrer_conversion_l1_days' })
      .andWhere('r.status IN (:...statuses)', { statuses: ['granted', 'pending_claim', 'capped'] })
      .getRawOne<{ count: string }>();

    const totalDaysGranted = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.daysGranted), 0)', 'sum')
      .where('r.status = :status', { status: 'granted' })
      .getRawOne<{ sum: string }>();

    const totalPendingDays = await this.sumPendingDaysTotal();

    return {
      totalReferred: Number(totalReferred?.count ?? 0),
      totalConverted: Number(totalConverted?.count ?? 0),
      totalDaysGranted: Number(totalDaysGranted?.sum ?? 0),
      totalPendingDays,
    };
  }
}
