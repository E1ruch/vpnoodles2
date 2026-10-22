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
      devices: sortDevices(devices),
    };
  }
}

/**
 * Remnawave не гарантирует порядок устройств в ответе, а кнопки удаления в боте
 * нумеруются позицией в списке — поэтому порядок фиксируем сами: по дате
 * подключения, с hwid как тай-брейкером. Без этого «Удалить устройство 2»
 * могло указать на другое устройство при следующем запросе списка.
 */
function sortDevices(devices: readonly HwidDevice[]): HwidDevice[] {
  return [...devices].sort((a, b) => {
    const left = toTime(a.createdAt);
    const right = toTime(b.createdAt);
    if (left !== right) return left - right;
    return a.hwid.localeCompare(b.hwid);
  });
}

/** Невалидные/отсутствующие даты уезжают в конец списка, а не ломают сортировку. */
function toTime(value: string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
