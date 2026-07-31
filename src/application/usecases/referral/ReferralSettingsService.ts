import type { IReferralSettingsRepository } from '../../../domain/interfaces/repositories.js';
import type { ICacheService } from '../../../domain/interfaces/services.js';
import type { ReferralSettings } from '../../../domain/entities/ReferralSettings.js';

const CACHE_KEY = 'referral:settings';
const CACHE_TTL_SECONDS = 60;

/**
 * Настройки реферальной программы — DB-backed, кэшируются в Redis по тому же принципу,
 * что и remnawave:state:{uuid} (см. CLAUDE.md): читаются часто (каждая активация trial
 * и покупка), меняются редко (только из админ-панели). save() обязан инвалидировать кэш,
 * иначе изменения из админки применятся только через CACHE_TTL_SECONDS.
 */
export class ReferralSettingsService {
  constructor(
    private settingsRepo: IReferralSettingsRepository,
    private cacheService: ICacheService,
  ) {}

  async get(): Promise<ReferralSettings> {
    const cached = await this.cacheService.get<ReferralSettings>(CACHE_KEY);
    if (cached) return cached;

    const settings = await this.settingsRepo.get();
    await this.cacheService.set(CACHE_KEY, settings, CACHE_TTL_SECONDS);
    return settings;
  }

  async update(data: Partial<ReferralSettings>): Promise<ReferralSettings> {
    const updated = await this.settingsRepo.update(data);
    await this.cacheService.delete(CACHE_KEY);
    return updated;
  }
}
