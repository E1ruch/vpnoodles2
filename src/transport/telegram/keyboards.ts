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
  buttons.push([{ text: '◀️ Назад', callback_data: 'back_main' }]);

  return { inline_keyboard: buttons };
}

export function paidPlansKeyboard(plans: Plan[]): InlineKeyboardMarkup {
  const buttons = plans.map((plan) => [
    {
      text: `${plan.name} — ${formatCurrency(plan.priceRub)} / ${plan.durationDays} дн.`,
      callback_data: `buy_${plan.id}`,
    },
  ]);

  buttons.push([{ text: '◀️ Назад', callback_data: 'plans' }]);

  return { inline_keyboard: buttons };
}

export function vpnActionsKeyboard(
  subscriptionId: string,
  isExpired: boolean,
): InlineKeyboardMarkup {
  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  if (isExpired) {
    buttons.push([{ text: '🔄 Продлить', callback_data: `renew_${subscriptionId}` }]);
  }

  buttons.push([{ text: '📖 Инструкция', callback_data: 'instructions' }]);
  buttons.push([{ text: '◀️ Назад', callback_data: 'back_main' }]);

  return { inline_keyboard: buttons };
}

export function trialConfirmKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '✅ Активировать бесплатный тариф', callback_data: 'activate_trial' }],
      [{ text: '◀️ Назад', callback_data: 'plans' }],
    ],
  };
}

export function backToMainKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'back_main' }]],
  };
}
