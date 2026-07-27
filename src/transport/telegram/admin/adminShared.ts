import type { Context } from 'telegraf';
import type { IUserRepository } from '../../../domain/interfaces/repositories.js';
import type { User } from '../../../domain/entities/User.js';
import type { NotificationType } from '../../../domain/entities/NotificationLog.js';
import { getEnv } from '../../../shared/config/env.js';

/**
 * Общая инфраструктура для всех групп админ-обработчиков (проверка прав,
 * пагинация, безопасный editMessageText, форматирование пользователя/действия).
 * Вынесено при разбиении AdminHandlers.ts (был 920 строк) на модули по доменным
 * группам — код не менялся, только перенос в переиспользуемые функции.
 */

export const BROADCAST_DELAY_MS = 50;

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
};

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  no_subscription_reminder_1h: '🔔 Нет подписки (1ч)',
  no_subscription_reminder_3d: '🔔 Нет подписки (3д)',
  trial_expiring_2d: '⏰ Окончание trial',
  paid_expiring_2d: '⏰ Окончание платной',
};

export function isAdmin(ctx: Context): boolean {
  const env = getEnv();
  const telegramId = ctx.from?.id;
  if (!telegramId) return false;

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

  return adminIds.has(telegramId);
}

export function isMessageNotModifiedError(err: unknown): boolean {
  const description =
    err && typeof err === 'object' && 'description' in err
      ? String((err as { description: unknown }).description)
      : err instanceof Error
        ? err.message
        : String(err);
  return description.includes('message is not modified');
}

export async function safeEditMessageText(
  ctx: Context,
  text: string,
  extra?: Parameters<Context['editMessageText']>[1],
): Promise<void> {
  try {
    await ctx.editMessageText(text, extra);
  } catch (err) {
    if (isMessageNotModifiedError(err)) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery().catch(() => undefined);
      }
      return;
    }
    throw err;
  }
}

export function parsePage(ctx: Context, fallback = 0): number {
  const cbData = ctx.callbackQuery;
  if (!cbData || !('data' in cbData) || !cbData.data) return fallback;

  const match = cbData.data.match(/_p(\d+)$/);
  if (!match?.[1]) return fallback;

  const page = Number.parseInt(match[1], 10);
  return Number.isFinite(page) && page >= 0 ? page : fallback;
}

export function totalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(0, page), totalPages - 1);
}

export function formatUserLabel(user: User | null | undefined, userId?: string): string {
  if (user) {
    const name = user.firstName ?? 'Без имени';
    const username = user.username ? `@${user.username}` : 'без username';
    return `${name} (${username}) · TG ${user.telegramId}`;
  }
  if (userId) return `ID ${userId.slice(0, 8)}…`;
  return 'Неизвестный пользователь';
}

export function formatActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatNotificationTypeLabel(type: NotificationType): string {
  return NOTIFICATION_TYPE_LABELS[type] ?? type;
}

export async function buildUserMap(
  userRepo: IUserRepository,
  userIds: string[],
): Promise<Map<string, User>> {
  const uniqueIds = [...new Set(userIds)];
  const users = await Promise.all(uniqueIds.map((id) => userRepo.findById(id)));
  const map = new Map<string, User>();
  for (const user of users) {
    if (user) map.set(user.id, user);
  }
  return map;
}
