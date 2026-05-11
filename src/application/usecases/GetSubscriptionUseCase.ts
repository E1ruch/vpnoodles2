import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import { NotFoundError } from '../../shared/errors/index.js';
import type { SyncSubscriptionDevicesUseCase } from './SyncSubscriptionDevicesUseCase.js';

export interface SubscriptionInfo {
  id: string;
  planId: string;
  planType: string;
  planName: string;
  status: string;
  startDate: Date;
  endDate: Date;
  deviceLimit: number;
  usedDevices: number;
  subscriptionUrl: string | null;
  isExpired: boolean;
  daysLeft: number;
}

export class GetSubscriptionUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private planRepo: IPlanRepository,
    private syncSubscriptionDevices: SyncSubscriptionDevicesUseCase,
  ) {}

  async execute(userId: string): Promise<SubscriptionInfo | null> {
    let subscription = await this.subscriptionRepo.findActiveByUserId(userId);
    if (!subscription) {
      const allSubscriptions = await this.subscriptionRepo.findByUserId(userId);
      if (allSubscriptions.length === 0) return null;
      subscription = allSubscriptions.sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? null;
      if (!subscription) return null;
    }

    const now = new Date();
    if (subscription.status === 'active' && subscription.endDate <= now) {
      subscription = await this.subscriptionRepo.update(subscription.id, { status: 'expired' });
    }

    const plan = await this.planRepo.findById(subscription.planId);
    if (!plan) {
      throw new NotFoundError('Plan', subscription.planId);
    }

    const daysLeft = Math.max(
      0,
      Math.ceil((subscription.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    );

    let usedDevices = subscription.usedDevices;
    if (subscription.remnawaveUserId) {
      await this.syncSubscriptionDevices.execute(subscription.id);
      const refreshed = await this.subscriptionRepo.findById(subscription.id);
      if (refreshed) usedDevices = refreshed.usedDevices;
    }

    return {
      id: subscription.id,
      planId: plan.id,
      planType: plan.type,
      planName: plan.name,
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      deviceLimit: subscription.deviceLimit,
      usedDevices,
      subscriptionUrl: subscription.subscriptionUrl,
      isExpired: subscription.isExpired,
      daysLeft,
    };
  }
}
