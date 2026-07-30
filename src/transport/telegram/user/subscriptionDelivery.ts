import type { Telegram } from 'telegraf';
import { Texts } from '../texts.js';
import { vpnActionsKeyboard } from '../keyboards.js';

/**
 * Единая точка выдачи подписки после оплаты/активации trial: одно текстовое
 * сообщение (ссылка + кнопки), вместо трёх последовательных как раньше.
 * QR-код и подробная инструкция — по кнопкам ('show_qr' / 'instructions'),
 * генерируются только по запросу, а не для каждого пользователя заранее.
 */
export async function sendSubscriptionDelivered(
  telegram: Telegram,
  chatId: number,
  subscriptionId: string,
  subscriptionUrl: string,
): Promise<void> {
  await telegram.sendMessage(chatId, Texts.SUBSCRIPTION_DELIVERED.replace('{url}', subscriptionUrl), {
    reply_markup: vpnActionsKeyboard(subscriptionId, false, false),
  });
}
