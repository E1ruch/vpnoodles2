import type {
  IUserRepository,
  ISubscriptionRepository,
  IAuditLogRepository,
} from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { ValidationError } from '../../shared/errors/index.js';
import { getLogger } from '../../shared/logger/index.js';

/**
 * Пользователь, ранее отключённый через DeactivateBlockedUserUseCase, снова
 * запустил бота — значит бот больше не заблокирован. Возвращаем isActive и
 * возобновляем доступ в Remnawave (resumeUser не выдаёт лишних дней — если
 * реальный срок подписки уже прошёл, пользователь просто увидит "истекла",
 * как и должно быть). Идемпотентно: для уже активного пользователя — no-op.
 */
export class RestoreBlockedUserUseCase {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(userId: string): Promise<void> {
    const logger = getLogger();

    const user = await this.userRepo.findById(userId);
    if (!user) throw new ValidationError('User not found');
    if (user.isActive !== false) return;

    await this.userRepo.update(userId, { isActive: true });

    const activeSub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (activeSub?.remnawaveUserId) {
      try {
        await this.remnawaveService.resumeUser(activeSub.remnawaveUserId);
      } catch (err) {
        logger.warn(
          { err, userId, remnawaveUserId: activeSub.remnawaveUserId },
          'Failed to resume Remnawave user after restoring access',
        );
      }
    }

    await this.auditLogRepo.create({
      userId,
      action: 'user_restored_access',
      entityType: 'user',
      entityId: userId,
      metadata: { remnawaveUserId: activeSub?.remnawaveUserId ?? null },
    });

    logger.info({ userId }, 'User restored access after unblocking the bot');
  }
}
