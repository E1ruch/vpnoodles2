import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { NotificationService } from '../../infrastructure/notifications/NotificationService.js';
import type { SyncSubscriptionExpiryUseCase } from './SyncSubscriptionExpiryUseCase.js';
import { getEnv } from '../../shared/config/env.js';
import { formatDate } from '../../shared/utils/index.js';
import { Texts } from '../../transport/telegram/texts.js';
import { trialExpiringReminderKeyboard } from '../../transport/telegram/keyboards.js';
import {
  runExpiringReminderTick,
  type ExpiringReminderTickResult,
} from './shared/runExpiringReminderTick.js';

export type TrialExpiringTickResult = ExpiringReminderTickResult;

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
    const env = getEnv();

    return runExpiringReminderTick(
      {
        subscriptionRepo: this.subscriptionRepo,
        notificationLogRepo: this.notificationLogRepo,
        notificationService: this.notificationService,
        syncSubscriptionExpiry: this.syncSubscriptionExpiry,
      },
      {
        days: env.NOTIFICATION_TRIAL_EXPIRING_DAYS,
        planType: 'trial',
        notificationType: 'trial_expiring_2d',
        buildText: (_sub, endDate, daysLeft) =>
          Texts.NOTIF_TRIAL_EXPIRING.replace('{endDate}', formatDate(endDate)).replace(
            '{daysLeft}',
            String(daysLeft),
          ),
        buildKeyboard: (sub) => trialExpiringReminderKeyboard(sub.id),
        buildMetadata: (sub, endDate, daysLeft) => ({
          subscriptionId: sub.id,
          endDate: endDate.toISOString(),
          daysLeft,
        }),
        missingTelegramIdWarnLabel: 'Trial expiring reminder: user telegramId missing',
        tickDoneLogLabel: 'Trial expiring reminders tick done',
      },
    );
  }
}
