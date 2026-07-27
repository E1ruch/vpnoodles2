import { TelegramError } from 'telegraf';

/**
 * Пользователь заблокировал бота или удалил аккаунт — Telegram возвращает
 * однозначный 403 без возможности когда-либо доставить сообщение, в отличие
 * от сетевых сбоев/таймаутов на стороне Telegram API. Ловим по коду и тексту
 * конкретной причины, а не по любому provider failure, чтобы не отключать
 * пользователей из-за временных проблем с доставкой.
 */
export function isTelegramBlockedError(err: unknown): boolean {
  if (!(err instanceof TelegramError)) return false;
  if (err.code !== 403) return false;
  const description = err.description ?? '';
  return (
    description.includes('bot was blocked by the user') ||
    description.includes('user is deactivated')
  );
}
