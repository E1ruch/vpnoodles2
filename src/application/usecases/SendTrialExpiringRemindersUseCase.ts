import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { NotificationService } from '../../infrastructure/notifications/NotificationService.js';
import type { SyncSubscriptionExpiryUseCase } from './SyncSubscriptionExpiryUseCase.js';
import { getLogger } from '../../shared/logger/index.js';
import { getEnv } from '../../shared/config/env.js';
import { formatDate } from '../../shared/utils/index.js';
import { Texts } from '../../transport/telegram/texts.js';
import { trialExpiringReminderKeyboard } from '../../transport/telegram/keyboards.js';

export interface TrialExpiringTickResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Напоминание за NOTIFICATION_TRIAL_EXPIRING_DAYS (по умолчанию 2) дней до окончания
 * бесплатного периода. Предлагает бесплатно продлиться на 14 дней — кнопка renew_<subId>,
 * которая обрабатывается существующим handleRenew (логика продления не меняется).
 *
 * Дедупликация — по (userId, type='trial_expiring_2d', entityId=subscriptionId, cycleKey=endDate).
 * После продления endDate меняется → cycleKey другой → уведомление снова сработает в следующем цикле.
 */
export class SendTrialExpiringRemindersUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private notificationLogRepo: INotificationLogRepository,
    private notificationService: NotificationService,
    private syncSubscriptionExpiry: SyncSubscriptionExpiryUseCase,
  ) {}

  async execute(): Promise<TrialExpiringTickResult> {
    const logger = getLogger();
    const env = getEnv();
    const days = env.NOTIFICATION_TRIAL_EXPIRING_DAYS;

    const result: TrialExpiringTickResult = { checked: 0, sent: 0, skipped: 0, failed: 0 };

    const candidates = await this.subscriptionRepo.findActiveExpiringWithinDays(days);
    result.checked = candidates.length;

    const now = new Date();
    const thresholdMs = now.getTime() + days * 24 * 60 * 60 * 1000;

    for (const sub of candidates) {
      // Интересуют только бесплатные подписки.
      if (!sub.plan || sub.plan.type !== 'trial') {
        result.skipped += 1;
        continue;
      }

      // Актуализируем endDate/status из Remnawave (источник истины), если есть привязка.
      let current = sub;
      if (sub.remnawaveUserId) {
        await this.syncSubscriptionExpiry.execute(sub.id);
        const refreshed = await this.subscriptionRepo.findById(sub.id);
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
      const alreadySent = await this.notificationLogRepo.exists(
        current.userId,
        'trial_expiring_2d',
        { entityId: current.id, cycleKey },
      );
      if (alreadySent) {
        result.skipped += 1;
        continue;
      }

      const daysLeft = Math.max(
        1,
        Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );

      const text = Texts.NOTIF_TRIAL_EXPIRING.replace('{endDate}', formatDate(endDate)).replace(
        '{daysLeft}',
        String(daysLeft),
      );

      const delivered = await this.notificationService.send({
        userId: current.userId,
        telegramId: Number(current.user?.telegramId ?? 0),
        type: 'trial_expiring_2d',
        text,
        replyMarkup: trialExpiringReminderKeyboard(current.id),
        entityType: 'subscription',
        entityId: current.id,
        cycleKey,
        metadata: {
          subscriptionId: current.id,
          endDate: endDate.toISOString(),
          daysLeft,
        },
      });

      if (!current.user?.telegramId) {
        logger.warn(
          { subscriptionId: current.id, userId: current.userId },
          'Trial expiring reminder: user telegramId missing',
        );
      }

      if (delivered) result.sent += 1;
      else result.failed += 1;
    }

    logger.info(
      { checked: result.checked, sent: result.sent, skipped: result.skipped, failed: result.failed },
      'Trial expiring reminders tick done',
    );
    return result;
  }
}
