import { InlineKeyboardMarkup } from 'telegraf/types';
import type { Plan } from '../../domain/entities/Plan.js';
import { formatCurrency } from '../../shared/utils/index.js';
import { Texts } from './texts.js';

/**
 * `showReferral` по умолчанию true — большинство мест, откуда зовётся эта клавиатура,
 * ещё не знают про реферальную программу и передавать флаг не будут (см. CLAUDE.md:
 * не трогаем то, что не обязаны). Вызовы, которым известно состояние
 * ReferralSettings.enabled (handleStart/handleBackMain/handleProfile в handlers.ts),
 * передают его явно — это и есть "рубильник прячет кнопки" из §7.4 плана.
 */
export function mainMenuKeyboard(showReferral: boolean = true): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [
    [
      { text: '🌐 Мой VPN', callback_data: 'my_vpn' },
      { text: '💎 Тарифы', callback_data: 'plans' },
    ],
    [
      { text: '👤 Профиль', callback_data: 'profile' },
      { text: '💬 Поддержка', callback_data: 'support' },
    ],
  ];

  if (showReferral) {
    rows.push([{ text: '🎁 Пригласить друзей', callback_data: 'referral_program' }]);
  }

  return { inline_keyboard: rows };
}

export function restoreAccessKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '✅ Восстановить доступ', callback_data: 'restore_access' }]],
  };
}

export function planSelectionKeyboard(): InlineKeyboardMarkup {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  buttons.push([{ text: '🆓 Бесплатный тариф', callback_data: 'plan_trial' }]);
  buttons.push([{ text: '💎 Платные тарифы', callback_data: 'plan_paid' }]);
  buttons.push([{ text: 'Назад', callback_data: 'back_main' }]);

  return { inline_keyboard: buttons };
}

export function paidPlansKeyboard(plans: Plan[]): InlineKeyboardMarkup {
  const buttons = plans.map((plan) => [
    {
      text: `${plan.name} — ${formatCurrency(plan.priceRub)} / ${plan.durationDays} дн.`,
      callback_data: `buy_${plan.id}`,
    },
  ]);

  buttons.push([{ text: 'Назад', callback_data: 'plans' }]);

  return { inline_keyboard: buttons };
}

export function adminKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '👥 Пользователи', callback_data: 'admin_users' },
        { text: '📊 Статистика', callback_data: 'admin_stats' },
      ],
      [
        { text: '📋 Логи', callback_data: 'admin_logs' },
        { text: '💳 Подписки', callback_data: 'admin_subscriptions' },
      ],
      [
        { text: '💰 Платежи', callback_data: 'admin_payments' },
        { text: '🖥 Сервера', callback_data: 'admin_servers' },
      ],
      [{ text: '🔔 Уведомления', callback_data: 'admin_notifications' }],
      [{ text: '📢 Рассылка', callback_data: 'admin_broadcast' }],
      [{ text: '🔄 Синхронизация с БД', callback_data: 'admin_sync' }],
      [{ text: '🚚 Миграция в Remnawave', callback_data: 'admin_migrate_remnawave' }],
      [{ text: 'Назад', callback_data: 'back_main' }],
    ],
  };
}

export function adminBackKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]],
  };
}

export function adminBroadcastKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✉️ Текст всем пользователям', callback_data: 'admin_broadcast_all' }],
      [{ text: '🎁 Подарок истёкшим (+7 дней)', callback_data: 'admin_broadcast_expired' }],
      [{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }],
    ],
  };
}

export function adminBroadcastConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✅ Отправить', callback_data: 'admin_broadcast_expired_confirm' }],
      [{ text: 'Отмена', callback_data: 'admin_broadcast' }],
    ],
  };
}

export function adminBroadcastCancelKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Отмена', callback_data: 'admin_broadcast_cancel' }]],
  };
}

export function adminMigrateConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✅ Продолжить миграцию', callback_data: 'admin_migrate_remnawave_confirm' }],
      [{ text: 'Отмена', callback_data: 'admin_menu' }],
    ],
  };
}

export type AdminListSection = 'users' | 'logs' | 'subs' | 'notifications';

export function adminPaginatedKeyboard(
  section: AdminListSection,
  page: number,
  totalPages: number,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
  const prefix = `admin_${section}`;

  if (totalPages > 1) {
    const navRow: Array<{ text: string; callback_data: string }> = [];
    if (page > 0) {
      navRow.push({ text: '◀️ Назад', callback_data: `${prefix}_p${page - 1}` });
    }
    if (page < totalPages - 1) {
      navRow.push({ text: 'Вперёд ▶️', callback_data: `${prefix}_p${page + 1}` });
    }
    if (navRow.length > 0) rows.push(navRow);
  }

  rows.push([{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]);
  return { inline_keyboard: rows };
}

export function vpnActionsKeyboard(
  subscriptionId: string,
  isExpired: boolean,
  showRenewButton: boolean = false,
  showReferralPromo: boolean = false,
): InlineKeyboardMarkup {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  if (isExpired || showRenewButton) {
    buttons.push([{ text: '🔄 Продлить', callback_data: `renew_${subscriptionId}` }]);
  }

  buttons.push([
    { text: '📷 QR-код', callback_data: 'show_qr' },
    { text: '📖 Инструкция', callback_data: 'instructions' },
  ]);

  if (showReferralPromo) {
    buttons.push([{ text: '🎁 Пригласить друзей', callback_data: 'referral_program' }]);
  }

  buttons.push([{ text: 'Назад', callback_data: 'back_main' }]);

  return { inline_keyboard: buttons };
}

export function trialConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✅ Активировать бесплатный тариф', callback_data: 'activate_trial' }],
      [{ text: 'Назад', callback_data: 'plans' }],
    ],
  };
}

export function pendingPaymentGateKeyboard(
  continuePayCallbackData: string | null,
  paymentId: string,
): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [];
  if (continuePayCallbackData) {
    rows.push([{ text: '💳 Продолжить оплату', callback_data: continuePayCallbackData }]);
  }
  rows.push([{ text: '❌ Отменить платёж', callback_data: `cancel_payment_${paymentId}` }]);
  rows.push([{ text: 'В главное меню', callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}

export function payLinkKeyboard(paymentId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '❌ Отменить платёж', callback_data: `cancel_payment_${paymentId}` }],
      [{ text: 'В главное меню', callback_data: 'back_main' }],
    ],
  };
}

export function backToMainKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'В главное меню', callback_data: 'back_main' }]],
  };
}

export function profileKeyboard(showReferral: boolean = true): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup['inline_keyboard'] = [[{ text: '📱 Устройства', callback_data: 'devices' }]];

  if (showReferral) {
    rows.push([{ text: '🎁 Рефералы', callback_data: 'referral_program' }]);
  }

  rows.push([{ text: 'Назад', callback_data: 'back_main' }]);

  return { inline_keyboard: rows };
}

/** Кнопка использует нативный share-sheet Телеграма (t.me/share/url) — ниже трения, чем "скопируйте ссылку". */
export function referralProgramKeyboard(referralLink: string): InlineKeyboardMarkup {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(
    Texts.REFERRAL_SHARE_PITCH,
  )}`;

  return {
    inline_keyboard: [
      [{ text: '📤 Поделиться с другом', url: shareUrl }],
      [{ text: 'Назад', callback_data: 'back_main' }],
    ],
  };
}

export function devicesKeyboard(
  deviceCount: number,
  showDeleteButtons: boolean,
): InlineKeyboardMarkup {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  if (showDeleteButtons && deviceCount > 0) {
    for (let i = 0; i < deviceCount; i++) {
      buttons.push([{ text: `🗑 Удалить устройство ${i + 1}`, callback_data: `del_dev_${i}` }]);
    }
  }

  buttons.push([{ text: 'Назад в профиль', callback_data: 'profile' }]);
  buttons.push([{ text: 'В главное меню', callback_data: 'back_main' }]);

  return { inline_keyboard: buttons };
}

export function deleteDeviceConfirmKeyboard(deviceIndex: number): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✅ Да, удалить', callback_data: `confirm_del_dev_${deviceIndex}` }],
      [{ text: 'Отмена', callback_data: 'devices' }],
    ],
  };
}

/** Клавиатура для напоминания «нет подписки» — ведёт в выбор тарифа. */
export function noSubscriptionReminderKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🆓 Активировать бесплатный тариф', callback_data: 'plan_trial' }],
      [{ text: '💎 Посмотреть тарифы', callback_data: 'plans' }],
    ],
  };
}

/** Клавиатура для напоминания об окончании trial — кнопка продления на 14 дней. */
export function trialExpiringReminderKeyboard(subscriptionId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '🔄 Продлить бесплатно на 14 дней', callback_data: `renew_${subscriptionId}` }],
      [{ text: '💎 Перейти на платный тариф', callback_data: 'plan_paid' }],
    ],
  };
}

/**
 * Клавиатура для напоминания об окончании платной подписки.
 * Платные подписки продлеваются через оплату, поэтому ведём в выбор платных тарифов
 * (handlePlanPaid → paidPlansKeyboard → buy_<planId> → оплата).
 */
export function paidExpiringReminderKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '💎 Продлить подписку', callback_data: 'plan_paid' }],
      [{ text: '🆓 Перейти на бесплатный тариф', callback_data: 'plan_trial' }],
    ],
  };
}
