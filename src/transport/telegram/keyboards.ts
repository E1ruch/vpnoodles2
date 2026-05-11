import { InlineKeyboardMarkup } from 'telegraf/types';
import type { Plan } from '../../domain/entities/Plan.js';
import { formatCurrency } from '../../shared/utils/index.js';

export function mainMenuKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '🌐 Мой VPN', callback_data: 'my_vpn' },
        { text: '💎 Тарифы', callback_data: 'plans' },
      ],
      [
        { text: '👤 Профиль', callback_data: 'profile' },
        { text: '💬 Поддержка', callback_data: 'support' },
      ],
    ],
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
      [{ text: '💰 Платежи', callback_data: 'admin_payments' }],
      [{ text: 'Назад', callback_data: 'back_main' }],
    ],
  };
}

export function adminBackKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]],
  };
}

export function vpnActionsKeyboard(
  subscriptionId: string,
  isExpired: boolean,
  showRenewButton: boolean = false,
): InlineKeyboardMarkup {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  if (isExpired || showRenewButton) {
    buttons.push([{ text: '🔄 Продлить', callback_data: `renew_${subscriptionId}` }]);
  }

  buttons.push([{ text: '📖 Инструкция', callback_data: 'instructions' }]);
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
