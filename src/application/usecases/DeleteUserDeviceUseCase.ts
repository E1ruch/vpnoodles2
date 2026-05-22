import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';
import type { SyncSubscriptionDevicesUseCase } from './SyncSubscriptionDevicesUseCase.js';

export class DeleteUserDeviceUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private remnawaveService: IRemnawaveService,
    private syncSubscriptionDevices: SyncSubscriptionDevicesUseCase,
  ) {}

  async execute(userId: string, hwid: string): Promise<void> {
    if (!hwid.trim()) {
      throw new ValidationError('HWID is required');
    }

    let subscription = await this.subscriptionRepo.findActiveByUserId(userId);
    if (!subscription) {
      const allSubscriptions = await this.subscriptionRepo.findByUserId(userId);
      subscription =
        allSubscriptions.sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0] ?? null;
    }

    if (!subscription?.remnawaveUserId) {
      throw new NotFoundError('Subscription', userId);
    }

    const { devices } = await this.remnawaveService.getHwidDevices(subscription.remnawaveUserId);
    const deviceExists = devices.some((d) => d.hwid === hwid);
    if (!deviceExists) {
      throw new NotFoundError('Device', hwid);
    }

    await this.remnawaveService.deleteHwidDevice(subscription.remnawaveUserId, hwid);
    await this.syncSubscriptionDevices.execute(subscription.id);
  }
}
