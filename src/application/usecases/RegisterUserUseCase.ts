import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { ReferralSettingsService } from './referral/ReferralSettingsService.js';
import { getLogger } from '../../shared/logger/index.js';

const REFERRAL_PAYLOAD_PREFIX = 'r_';

export class RegisterUserUseCase {
  constructor(
    private userRepo: IUserRepository,
    private auditLogRepo: IAuditLogRepository,
    private referralSettings: ReferralSettingsService,
  ) {}

  async execute(
    telegramId: number,
    username: string | null,
    firstName: string | null,
    startPayload?: string | null,
  ): Promise<string> {
    const logger = getLogger();

    const existing = await this.userRepo.findByTelegramId(telegramId);
    if (existing) {
      logger.info({ telegramId }, 'User already exists');
      return existing.id;
    }

    const user = await this.userRepo.create({
      telegramId,
      username: username ?? null,
      firstName: firstName ?? null,
      isActive: true,
      hasUsedTrial: false,
    });

    await this.auditLogRepo.create({
      userId: user.id,
      action: 'user_registered',
      entityType: 'user',
      entityId: user.id,
    });

    // Атрибуция реферала — только на ветке нового пользователя (см. §5.1 плана),
    // best-effort: сбой здесь не должен ломать регистрацию.
    await this.attributeReferral(user.id, startPayload, logger);

    logger.info({ telegramId, userId: user.id }, 'User registered');
    return user.id;
  }

  private async attributeReferral(
    newUserId: string,
    startPayload: string | null | undefined,
    logger: ReturnType<typeof getLogger>,
  ): Promise<void> {
    if (!startPayload?.startsWith(REFERRAL_PAYLOAD_PREFIX)) return;

    try {
      const settings = await this.referralSettings.get();
      if (!settings.enabled) return;

      const code = startPayload.slice(REFERRAL_PAYLOAD_PREFIX.length);
      if (!code) return;

      const referrer = await this.userRepo.findByReferralCode(code);
      if (!referrer) {
        // Неизвестный/устаревший код — регистрация уже прошла успешно, просто без атрибуции.
        logger.info({ newUserId, code }, 'Referral code not found, skipping attribution');
        return;
      }
      if (referrer.id === newUserId) return; // самореферал, невозможен на новом пользователе, но кодифицируем

      await this.userRepo.update(newUserId, { referredByUserId: referrer.id });
      await this.auditLogRepo.create({
        userId: newUserId,
        action: 'referral_attributed',
        entityType: 'user',
        entityId: referrer.id,
        metadata: { referralCode: code },
      });

      logger.info({ newUserId, referrerUserId: referrer.id }, 'Referral attributed');
    } catch (err) {
      logger.error({ err, newUserId }, 'Referral attribution failed');
    }
  }
}
