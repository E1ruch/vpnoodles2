/** Зеркало ACTION_LABELS/NOTIFICATION_TYPE_LABELS из src/transport/telegram/admin/adminShared.ts — свой рантайм, синхронизировать вручную при изменениях. */

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  no_subscription_reminder_1h: '🔔 Нет подписки (1ч)',
  no_subscription_reminder_3d: '🔔 Нет подписки (3д)',
  trial_expiring_2d: '⏰ Окончание trial',
  paid_expiring_2d: '⏰ Окончание платной',
};

export const ACTION_LABELS: Record<string, string> = {
  user_registered: '👤 Регистрация',
  trial_activated: '🆓 Активация trial',
  subscription_purchased: '💎 Покупка подписки',
  subscription_renewed: '🔄 Продление',
  telegram_payment_successful: '💳 Оплата в Telegram',
  broadcast_all: '📢 Рассылка всем',
  broadcast_expired_gift: '🎁 Подарок истёкшим',
  sync_remnawave: '🔄 Синхронизация Remnawave',
  migrate_remnawave: '🚚 Миграция в Remnawave',
  user_blocked_bot: '🚫 Заблокировал бота',
  user_restored_access: '✅ Восстановил доступ',
  admin_custom_notification_user: '✉️ Уведомление пользователю',
  admin_custom_notification_all: '📢 Рассылка (конструктор)',
};

export function formatNotificationType(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

export function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
