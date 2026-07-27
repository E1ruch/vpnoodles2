import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { ISubscriptionRepository } from '../../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../../domain/interfaces/repositories.js';
import type { NotificationService } from '../../../infrastructure/notifications/NotificationService.js';
import type { SyncSubscriptionExpiryUseCase } from '../SyncSubscriptionExpiryUseCase.js';
import type { Subscription } from '../../../domain/entities/Subscription.js';
import type { NotificationType } from '../../../domain/entities/NotificationLog.js';
import { getLogger } from '../../../shared/logger/index.js';

export interface ExpiringReminderTickResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

export interface ExpiringReminderDeps {
  subscriptionRepo: ISubscriptionRepository;
  notificationLogRepo: INotificationLogRepository;
  notificationService: NotificationService;
  syncSubscriptionExpiry: SyncSubscriptionExpiryUseCase;
}

export interface ExpiringReminderConfig {
  days: number;
  planType: 'trial' | 'paid';
  notificationType: NotificationType;
  buildText(sub: Subscription, endDate: Date, daysLeft: number): string;
  buildKeyboard(sub: Subscription): InlineKeyboardMarkup;
  buildMetadata(sub: Subscription, endDate: Date, daysLeft: number): Record<string, unknown>;
  missingTelegramIdWarnLabel: string;
  tickDoneLogLabel: string;
}

/**
 * Общая логика напоминаний «подписка скоро закончится». SendTrialExpiringRemindersUseCase
 * и SendPaidExpiringRemindersUseCase были идентичны почти построчно — отличались только
 * фильтром типа тарифа, текстом, клавиатурой и метаданными уведомления. Вынесено в одну
 * функцию, чтобы при следующей правке (например, изменении окна дедупликации) не пришлось
 * синхронизировать два файла руками. Поведение не менялось, только перенос.
 */
export async function runExpiringReminderTick(
  deps: ExpiringReminderDeps,
  config: ExpiringReminderConfig,
): Promise<ExpiringReminderTickResult> {
  const logger = getLogger();
  const result: ExpiringReminderTickResult = { checked: 0, sent: 0, skipped: 0, failed: 0 };

  const candidates = await deps.subscriptionRepo.findActiveExpiringWithinDays(config.days);
  result.checked = candidates.length;

  const now = new Date();
  const thresholdMs = now.getTime() + config.days * 24 * 60 * 60 * 1000;

  for (const sub of candidates) {
    if (!sub.plan || sub.plan.type !== config.planType) {
      result.skipped += 1;
      continue;
    }

    // Актуализируем endDate/status из Remnawave (источник истины), если есть привязка.
    let current = sub;
    if (sub.remnawaveUserId) {
      await deps.syncSubscriptionExpiry.execute(sub.id);
      const refreshed = await deps.subscriptionRepo.findById(sub.id);
      if (refreshed) current = refreshed;
    }

    // После синхронизации могли измениться статус/дата — перепроверяем окно.
    if (current.status !== 'active') {
      result.skipped += 1;
      continue;
    }
    const endDate = new Date(current.endDate);
    if (endDate <= now || endDate.getTime() > thresholdMs) {
      result.skipped += 1;
      continue;
    }

    const cycleKey = endDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const alreadySent = await deps.notificationLogRepo.exists(current.userId, config.notificationType, {
      entityId: current.id,
      cycleKey,
    });
    if (alreadySent) {
      result.skipped += 1;
      continue;
    }

    const daysLeft = Math.max(1, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    const delivered = await deps.notificationService.send({
      userId: current.userId,
      telegramId: Number(current.user?.telegramId ?? 0),
      type: config.notificationType,
      text: config.buildText(current, endDate, daysLeft),
      replyMarkup: config.buildKeyboard(current),
      entityType: 'subscription',
      entityId: current.id,
      cycleKey,
      metadata: config.buildMetadata(current, endDate, daysLeft),
    });

    if (!current.user?.telegramId) {
      logger.warn({ subscriptionId: current.id, userId: current.userId }, config.missingTelegramIdWarnLabel);
    }

    if (delivered) result.sent += 1;
    else result.failed += 1;
  }

  logger.info(
    { checked: result.checked, sent: result.sent, skipped: result.skipped, failed: result.failed },
    config.tickDoneLogLabel,
  );
  return result;
}
