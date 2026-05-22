import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { HwidDevice } from '../../shared/types/index.js';

export interface UserDevicesInfo {
  subscriptionId: string;
  deviceLimit: number;
  total: number;
  devices: HwidDevice[];
}

export class GetUserDevicesUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(userId: string): Promise<UserDevicesInfo | null> {
    let subscription = await this.subscriptionRepo.findActiveByUserId(userId);
    if (!subscription) {
      const allSubscriptions = await this.subscriptionRepo.findByUserId(userId);
      if (allSubscriptions.length === 0) return null;
      subscription =
        allSubscriptions.sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? null;
      if (!subscription) return null;
    }

    if (!subscription.remnawaveUserId) return null;

    const { total, devices } = await this.remnawaveService.getHwidDevices(
      subscription.remnawaveUserId,
    );

    return {
      subscriptionId: subscription.id,
      deviceLimit: subscription.deviceLimit,
      total,
      devices,
    };
  }
}
