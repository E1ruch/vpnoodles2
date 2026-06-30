import type { Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { NotificationType } from '../../domain/entities/NotificationLog.js';
import { getLogger } from '../../shared/logger/index.js';

export interface SendNotificationInput {
  userId: string;
  telegramId: number;
  type: NotificationType;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
  /** Тип и id связанной сущности для журнала (например, subscription / subId). */
  entityType?: string | null;
  entityId?: string | null;
  /** Ключ цикла для дедупликации повторяющихся уведомлений. */
  cycleKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Отправляет пользователю Telegram-сообщение и фиксирует факт отправки в notification_logs.
 * Источник истины по «отправлено или нет» — таблица notification_logs.
 */
export class NotificationService {
  constructor(
    private bot: Telegraf,
    private notificationLogRepo: INotificationLogRepository,
  ) {}

  async send(input: SendNotificationInput): Promise<boolean> {
    const logger = getLogger();
    let delivered = true;
    let errorMessage: string | null = null;

    try {
      await this.bot.telegram.sendMessage(input.telegramId, input.text, {
        reply_markup: input.replyMarkup,
      });
    } catch (err) {
      delivered = false;
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, telegramId: input.telegramId, type: input.type },
        'Notification send failed',
      );
    }

    try {
      await this.notificationLogRepo.create({
        userId: input.userId,
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        cycleKey: input.cycleKey ?? null,
        delivered,
        errorMessage,
        metadata: input.metadata ?? null,
      });
    } catch (logErr) {
      logger.error(
        { err: logErr, userId: input.userId, type: input.type },
        'Failed to persist notification log',
      );
    }

    return delivered;
  }
}
