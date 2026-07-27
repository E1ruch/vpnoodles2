import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { NotificationService } from '../../infrastructure/notifications/NotificationService.js';
import type { SyncSubscriptionExpiryUseCase } from './SyncSubscriptionExpiryUseCase.js';
import { getEnv } from '../../shared/config/env.js';
import { formatDate } from '../../shared/utils/index.js';
import { Texts } from '../../transport/telegram/texts.js';
import { paidExpiringReminderKeyboard } from '../../transport/telegram/keyboards.js';
import {
  runExpiringReminderTick,
  type ExpiringReminderTickResult,
} from './shared/runExpiringReminderTick.js';

export type PaidExpiringTickResult = ExpiringReminderTickResult;

/**
 * Напоминание за NOTIFICATION_PAID_EXPIRING_DAYS (по умолчанию 2) дней до окончания
 * платной подписки. Предлагает продлиться — кнопка ведёт в выбор платных тарифов
 * (handlePlanPaid → paidPlansKeyboard → buy_<planId> → оплата), логика продления/оплаты
 * не меняется.
 *
 * Дедупликация — по (userId, type='paid_expiring_2d', entityId=subscriptionId, cycleKey=endDate).
 * После продления/новой оплаты endDate меняется → cycleKey другой → уведомление снова
 * сработает в следующем цикле.
 */
export class SendPaidExpiringRemindersUseCase {
  constructor(
    private subscriptionRepo: ISubscriptionRepository,
    private notificationLogRepo: INotificationLogRepository,
    private notificationService: NotificationService,
    private syncSubscriptionExpiry: SyncSubscriptionExpiryUseCase,
  ) {}

  async execute(): Promise<PaidExpiringTickResult> {
    const env = getEnv();

    return runExpiringReminderTick(
      {
        subscriptionRepo: this.subscriptionRepo,
        notificationLogRepo: this.notificationLogRepo,
        notificationService: this.notificationService,
        syncSubscriptionExpiry: this.syncSubscriptionExpiry,
      },
      {
        days: env.NOTIFICATION_PAID_EXPIRING_DAYS,
        planType: 'paid',
        notificationType: 'paid_expiring_2d',
        buildText: (sub, endDate, daysLeft) =>
          Texts.NOTIF_PAID_EXPIRING.replace('{planName}', sub.plan?.name ?? 'Платный тариф')
            .replace('{endDate}', formatDate(endDate))
            .replace('{daysLeft}', String(daysLeft)),
        buildKeyboard: () => paidExpiringReminderKeyboard(),
        buildMetadata: (sub, endDate, daysLeft) => ({
          subscriptionId: sub.id,
          planId: sub.planId,
          planName: sub.plan?.name ?? 'Платный тариф',
          endDate: endDate.toISOString(),
          daysLeft,
        }),
        missingTelegramIdWarnLabel: 'Paid expiring reminder: user telegramId missing',
        tickDoneLogLabel: 'Paid expiring reminders tick done',
      },
    );
  }
}
