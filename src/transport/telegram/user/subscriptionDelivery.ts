import type { Telegram } from 'telegraf';
import { Texts } from '../texts.js';
import { vpnActionsKeyboard } from '../keyboards.js';

export interface SubscriptionDeliveredReferralInfo {
  /** Личный бонус ЭТОГО получателя за переход по чужой ссылке (§2.1/§6.4) — только для trial. */
  perkApplied?: { days: number; trafficGb: number } | null;
  /** Реферальная программа включена — показать промо-строку и кнопку "Пригласить друзей" (§6.1). */
  promoEnabled: boolean;
}

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
  referralInfo?: SubscriptionDeliveredReferralInfo,
): Promise<void> {
  const perk = referralInfo?.perkApplied;
  const referralPerkLine = !perk
    ? ''
    : perk.trafficGb > 0
      ? Texts.REFERRAL_SIGNUP_PERK_LINE_TRAFFIC.replace('{trafficGb}', String(perk.trafficGb))
      : perk.days > 0
        ? Texts.REFERRAL_SIGNUP_PERK_LINE_DAYS.replace('{days}', String(perk.days))
        : '';

  const referralPromoLine = referralInfo?.promoEnabled ? Texts.SUBSCRIPTION_DELIVERED_REFERRAL_PROMO : '';

  const text = Texts.SUBSCRIPTION_DELIVERED.replace('{url}', subscriptionUrl)
    .replace('{referralPerkLine}', referralPerkLine)
    .replace('{referralPromoLine}', referralPromoLine);

  await telegram.sendMessage(chatId, text, {
    reply_markup: vpnActionsKeyboard(subscriptionId, false, false, Boolean(referralInfo?.promoEnabled)),
  });
}
