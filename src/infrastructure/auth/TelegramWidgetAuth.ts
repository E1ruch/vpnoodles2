import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Пейлоад, который Telegram Login Widget передаёт колбэком после логина
 * (https://core.telegram.org/widgets/login#receiving-authorization-data).
 */
export interface TelegramWidgetAuthPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/** Максимальный возраст auth_date, после которого пейлоад считается протухшим (защита от replay). */
export const TELEGRAM_WIDGET_AUTH_MAX_AGE_SECONDS = 86400;

/**
 * Проверяет подпись данных от Telegram Login Widget: data-check-string
 * (отсортированные `key=value` через `\n`, без hash) подписывается
 * HMAC-SHA256 с ключом SHA256(bot token) — результат должен совпасть с hash.
 * Дополнительно отклоняет пейлоады с протухшим auth_date.
 */
export function verifyTelegramWidgetAuth(
  payload: TelegramWidgetAuthPayload,
  botToken: string,
  options?: { maxAgeSeconds?: number; now?: () => Date },
): boolean {
  const { hash, ...fields } = payload;
  if (!hash || typeof hash !== 'string') return false;

  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const expectedBuf = Buffer.from(expectedHash, 'hex');
  const receivedBuf = Buffer.from(hash, 'hex');
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) {
    return false;
  }

  const maxAgeSeconds = options?.maxAgeSeconds ?? TELEGRAM_WIDGET_AUTH_MAX_AGE_SECONDS;
  const now = options?.now ? options.now() : new Date();
  const ageSeconds = now.getTime() / 1000 - payload.auth_date;
  if (!Number.isFinite(ageSeconds) || ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
    return false;
  }

  return true;
}
