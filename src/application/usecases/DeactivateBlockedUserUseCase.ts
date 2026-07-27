import type {
  IUserRepository,
  ISubscriptionRepository,
  IAuditLogRepository,
} from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';

/**
 * Реакция на то, что пользователь заблокировал бота (детект — 403 от Telegram
 * при отправке напоминания/рассылки, см. isTelegramBlockedError). Помечаем
 * неактивным в БД — это поле уже используется в SendNoSubscriptionRemindersUseCase
 * для пропуска рассылок — и приостанавливаем доступ в Remnawave, если есть активная
 * подписка: нет смысла держать слот и продлевать того, кого нельзя оповестить.
 * Идемпотентно: повторный вызов для уже неактивного пользователя ничего не делает.
 */
export class DeactivateBlockedUserUseCase {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  async execute(userId: string): Promise<void> {
    const logger = getLogger();

    const user = await this.userRepo.findById(userId);
    if (!user || user.isActive === false) return;

    await this.userRepo.update(userId, { isActive: false });

    const activeSub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (activeSub?.remnawaveUserId) {
      try {
        await this.remnawaveService.suspendUser(activeSub.remnawaveUserId);
      } catch (err) {
        // Даже если панель недоступна — пользователь всё равно должен перестать
        // получать рассылки. Приостановку в Remnawave можно будет доделать вручную.
        logger.warn(
          { err, userId, remnawaveUserId: activeSub.remnawaveUserId },
          'Failed to suspend Remnawave user after bot block',
        );
      }
    }

    await this.auditLogRepo.create({
      userId,
      action: 'user_blocked_bot',
      entityType: 'user',
      entityId: userId,
      metadata: { remnawaveUserId: activeSub?.remnawaveUserId ?? null },
    });

    logger.info({ userId }, 'User deactivated after blocking the bot');
  }
}
