/** Зеркало ACTION_LABELS/NOTIFICATION_TYPE_LABELS из src/transport/telegram/admin/adminShared.ts — свой рантайм, синхронизировать вручную при изменениях. */

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  no_subscription_reminder_1h: '🔔 Нет подписки (1ч)',
  no_subscription_reminder_3d: '🔔 Нет подписки (3д)',
  trial_expiring_2d: '⏰ Окончание trial',
  paid_expiring_2d: '⏰ Окончание платной',
  referral_signup_reward: '🎁 Реферальный бонус (сигнап)',
  referral_conversion_reward: '🎁 Реферальный бонус (оплата)',
  referral_pending_reward: '🎁 Реферальный бонус (в ожидании)',
  referral_milestone_reward: '🏆 Реферальная веха',
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
  referral_attributed: '🎁 Атрибуция реферала',
};

/** Зеркало ReferralRewardType из src/domain/entities/ReferralReward.ts. */
export const REFERRAL_REWARD_TYPE_LABELS: Record<string, string> = {
  referred_signup_perk: 'Бонус за переход по ссылке',
  referrer_signup: 'Бонус за сигнап друга',
  referrer_conversion_l1_days: 'Бонус за оплату (дни)',
  referrer_conversion_l1_traffic: 'Бонус за оплату (трафик)',
  referrer_conversion_l2: 'Пирамида (уровень 2)',
  milestone: 'Веха',
};

export function formatNotificationType(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

export function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatReferralRewardType(type: string): string {
  return REFERRAL_REWARD_TYPE_LABELS[type] ?? type;
}
