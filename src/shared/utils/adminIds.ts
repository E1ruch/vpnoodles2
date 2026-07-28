import type { Env } from '../config/env.js';

/**
 * Единый парсер allowlist'а админских Telegram ID из ADMIN_TELEGRAM_ID +
 * ADMIN_TELEGRAM_IDS. Используется и Telegram-стороной (isAdmin(ctx) в
 * transport/telegram/admin/adminShared.ts), и HTTP-авторизацией веб-панели —
 * чтобы список админов не парсился в двух местах по-разному.
 */
export function parseAdminIds(env: Pick<Env, 'ADMIN_TELEGRAM_ID' | 'ADMIN_TELEGRAM_IDS'>): Set<number> {
  const adminIds = new Set<number>();

  if (typeof env.ADMIN_TELEGRAM_ID === 'number' && Number.isFinite(env.ADMIN_TELEGRAM_ID)) {
    adminIds.add(env.ADMIN_TELEGRAM_ID);
  }

  const idsFromEnv = (env.ADMIN_TELEGRAM_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  for (const id of idsFromEnv) {
    adminIds.add(id);
  }

  return adminIds;
}
