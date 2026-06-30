import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { NotificationService } from '../../infrastructure/notifications/NotificationService.js';
import { getLogger } from '../../shared/logger/index.js';
import { getEnv } from '../../shared/config/env.js';
import { Texts } from '../../transport/telegram/texts.js';
import { noSubscriptionReminderKeyboard } from '../../transport/telegram/keyboards.js';

export interface ReminderTickResult {
  checked: number;
  sentWave1: number;
  sentWave2: number;
  failed: number;
}

/**
 * Напоминания пользователям, которые авторизовались в боте (есть запись в users),
 * но не получили ни бесплатную, ни платную подписку (нет записей в subscriptions).
 *
 * Две волны:
 *  1) через NOTIFICATION_NO_SUB_FIRST_DELAY_HOURS (по умолчанию 1 час) после регистрации;
 *  2) через NOTIFICATION_NO_SUB_SECOND_DELAY_DAYS (по умолчанию 3 дня) после регистрации.
 *
 * Дедупликация — по таблице notification_logs (типы no_subscription_reminder_1h / _3d).
 * Текущая логика подписок и бд не изменяется.
 */
export class SendNoSubscriptionRemindersUseCase {
  constructor(
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private notificationLogRepo: INotificationLogRepository,
    private notificationService: NotificationService,
  ) {}

  async execute(): Promise<ReminderTickResult> {
    const logger = getLogger();
    const env = getEnv();

    const result: ReminderTickResult = { checked: 0, sentWave1: 0, sentWave2: 0, failed: 0 };
    const now = Date.now();
    const firstDelayMs = env.NOTIFICATION_NO_SUB_FIRST_DELAY_HOURS * 60 * 60 * 1000;
    const secondDelayMs = env.NOTIFICATION_NO_SUB_SECOND_DELAY_DAYS * 24 * 60 * 60 * 1000;

    const users = await this.userRepo.findAll();
    result.checked = users.length;

    for (const user of users) {
      // Пропускаем неактивных пользователей.
      if (user.isActive === false) continue;

      const ageMs = now - new Date(user.createdAt).getTime();
      if (ageMs < firstDelayMs) continue;

      // Есть хоть какая-то подписка (бесплатная или платная, любая давность) — не беспокоим.
      const subscriptions = await this.subscriptionRepo.findByUserId(user.id);
      if (subscriptions.length > 0) continue;

      const firstName = user.firstName ?? 'друг';

      // Волна 1 — через 1 час.
      if (ageMs >= firstDelayMs) {
        const alreadySent1 = await this.notificationLogRepo.exists(
          user.id,
          'no_subscription_reminder_1h',
        );
        if (!alreadySent1) {
          const delivered = await this.notificationService.send({
            userId: user.id,
            telegramId: Number(user.telegramId),
            type: 'no_subscription_reminder_1h',
            text: Texts.NOTIF_NO_SUBSCRIPTION_1H.replace('{firstName}', firstName),
            replyMarkup: noSubscriptionReminderKeyboard(),
            entityType: 'user',
            entityId: user.id,
            metadata: { ageHours: Math.round(ageMs / (60 * 60 * 1000)) },
          });
          if (delivered) result.sentWave1 += 1;
          else result.failed += 1;
        }
      }

      // Волна 2 — через 3 дня.
      if (ageMs >= secondDelayMs) {
        const alreadySent2 = await this.notificationLogRepo.exists(
          user.id,
          'no_subscription_reminder_3d',
        );
        if (!alreadySent2) {
          const delivered = await this.notificationService.send({
            userId: user.id,
            telegramId: Number(user.telegramId),
            type: 'no_subscription_reminder_3d',
            text: Texts.NOTIF_NO_SUBSCRIPTION_3D.replace('{firstName}', firstName),
            replyMarkup: noSubscriptionReminderKeyboard(),
            entityType: 'user',
            entityId: user.id,
            metadata: { ageHours: Math.round(ageMs / (60 * 60 * 1000)) },
          });
          if (delivered) result.sentWave2 += 1;
          else result.failed += 1;
        }
      }
    }

    logger.info(
      { checked: result.checked, sentWave1: result.sentWave1, sentWave2: result.sentWave2, failed: result.failed },
      'No-subscription reminders tick done',
    );
    return result;
  }
}
