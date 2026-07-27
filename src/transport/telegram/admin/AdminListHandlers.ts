import { Context, Telegraf } from 'telegraf';
import type {
  IUserRepository,
  IPlanRepository,
  ISubscriptionRepository,
  IAuditLogRepository,
  INotificationLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { User } from '../../../domain/entities/User.js';
import type { AuditLog } from '../../../domain/entities/AuditLog.js';
import type { Subscription } from '../../../domain/entities/Subscription.js';
import { formatDate } from '../../../shared/utils/index.js';
import { adminPaginatedKeyboard } from '../keyboards.js';
import {
  isAdmin,
  safeEditMessageText,
  parsePage,
  totalPages,
  clampPage,
  formatUserLabel,
  formatActionLabel,
  formatNotificationTypeLabel,
  buildUserMap,
} from './adminShared.js';

const ADMIN_USERS_PAGE_SIZE = 10;
const ADMIN_LOGS_PAGE_SIZE = 6;
const ADMIN_SUBS_PAGE_SIZE = 6;
const ADMIN_NOTIFICATIONS_PAGE_SIZE = 8;

/**
 * Пагинированные списки: пользователи, логи действий, подписки, журнал
 * уведомлений. Вынесено из AdminHandlers при разбиении файла (был 920 строк)
 * на модули по доменным группам — код и тексты не менялись, только перенос.
 */
export class AdminListHandlers {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private notificationLogRepo: INotificationLogRepository,
  ) {}

  register(bot: Telegraf): void {
    bot.action('admin_users', this.handleAdminUsers);
    bot.action(/^admin_users_p(\d+)$/, this.handleAdminUsers);
    bot.action('admin_logs', this.handleAdminLogs);
    bot.action(/^admin_logs_p(\d+)$/, this.handleAdminLogs);
    bot.action('admin_subscriptions', this.handleAdminSubscriptions);
    bot.action(/^admin_subs_p(\d+)$/, this.handleAdminSubscriptions);
    bot.action('admin_notifications', this.handleAdminNotifications);
    bot.action(/^admin_notifications_p(\d+)$/, this.handleAdminNotifications);
  }

  private handleAdminUsers = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    try {
      const users = await this.userRepo.findAll();
      const pages = totalPages(users.length, ADMIN_USERS_PAGE_SIZE);
      const page = clampPage(parsePage(ctx), pages);
      const slice = users.slice(
        page * ADMIN_USERS_PAGE_SIZE,
        page * ADMIN_USERS_PAGE_SIZE + ADMIN_USERS_PAGE_SIZE,
      );

      let text = `👥 Пользователи\n`;
      text += `Всего: ${users.length} · Страница ${page + 1}/${pages}\n\n`;

      if (slice.length === 0) {
        text += 'Список пуст.';
      } else {
        slice.forEach((user, index) => {
          const num = page * ADMIN_USERS_PAGE_SIZE + index + 1;
          text += `${num}. ${formatUserLabel(user)}\n`;
          text += `   📅 ${formatDate(user.createdAt)}\n`;
        });
      }

      await safeEditMessageText(ctx, text, {
        reply_markup: adminPaginatedKeyboard('users', page, pages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки пользователей');
    }
  };

  private formatLogEntry(log: AuditLog, index: number, user?: User): string {
    let block = `${index}. ${formatActionLabel(log.action)}\n`;
    block += `   👤 ${formatUserLabel(user, log.userId)}\n`;
    if (log.entityType) {
      const entity = log.entityId ? `${log.entityType} · ${log.entityId.slice(0, 8)}…` : log.entityType;
      block += `   📦 ${entity}\n`;
    }
    block += `   🕐 ${formatDate(log.createdAt)}\n`;
    return `${block}\n`;
  }

  private handleAdminLogs = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    try {
      const total = await this.auditLogRepo.count();
      const pages = totalPages(total, ADMIN_LOGS_PAGE_SIZE);
      const page = clampPage(parsePage(ctx), pages);

      const logs = await this.auditLogRepo.findAll({
        limit: ADMIN_LOGS_PAGE_SIZE,
        skip: page * ADMIN_LOGS_PAGE_SIZE,
        order: { createdAt: 'DESC' },
      });

      const userMap = await buildUserMap(this.userRepo, logs.map((log) => log.userId));

      let text = `📋 Логи действий\n`;
      text += `Всего: ${total} · Страница ${page + 1}/${pages}\n\n`;

      if (logs.length === 0) {
        text += 'Логов пока нет.';
      } else {
        logs.forEach((log, index) => {
          text += this.formatLogEntry(log, index + 1, userMap.get(log.userId));
        });
      }

      await safeEditMessageText(ctx, text, {
        reply_markup: adminPaginatedKeyboard('logs', page, pages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки логов');
    }
  };

  private handleAdminSubscriptions = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    try {
      const subscriptions = await this.subscriptionRepo.findAll();
      const pages = totalPages(subscriptions.length, ADMIN_SUBS_PAGE_SIZE);
      const page = clampPage(parsePage(ctx), pages);
      const slice = subscriptions.slice(
        page * ADMIN_SUBS_PAGE_SIZE,
        page * ADMIN_SUBS_PAGE_SIZE + ADMIN_SUBS_PAGE_SIZE,
      );

      let text = `💳 Подписки\n`;
      text += `Всего: ${subscriptions.length} · Страница ${page + 1}/${pages}\n\n`;

      if (slice.length === 0) {
        text += 'Подписок пока нет.';
      } else {
        for (let i = 0; i < slice.length; i++) {
          const sub = slice[i] as Subscription;
          const num = page * ADMIN_SUBS_PAGE_SIZE + i + 1;
          const plan = sub.plan ?? (await this.planRepo.findById(sub.planId));
          const planName = plan?.name ?? 'Неизвестно';
          const user = sub.user ?? (await this.userRepo.findById(sub.userId));

          text += `${num}. ${formatUserLabel(user, sub.userId)}\n`;
          text += `   💎 ${planName} · ${sub.status}\n`;
          text += `   📅 до ${formatDate(sub.endDate)} · 📱 ${sub.usedDevices}/${sub.deviceLimit}\n\n`;
        }
      }

      await safeEditMessageText(ctx, text.trimEnd(), {
        reply_markup: adminPaginatedKeyboard('subs', page, pages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки подписок');
    }
  };

  private handleAdminNotifications = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    try {
      const total = await this.notificationLogRepo.countAll();
      const pages = totalPages(total, ADMIN_NOTIFICATIONS_PAGE_SIZE);
      const page = clampPage(parsePage(ctx), pages);

      const [stats, logs] = await Promise.all([
        this.notificationLogRepo.getStats(),
        this.notificationLogRepo.findAll({
          limit: ADMIN_NOTIFICATIONS_PAGE_SIZE,
          skip: page * ADMIN_NOTIFICATIONS_PAGE_SIZE,
          order: { createdAt: 'DESC' },
        }),
      ]);

      const userMap = await buildUserMap(this.userRepo, logs.map((log) => log.userId));

      let text = `🔔 Уведомления\n`;
      text += `Всего: ${stats.total} · ✅ Доставлено: ${stats.delivered}${stats.failed > 0 ? ` · ❌ Ошибок: ${stats.failed}` : ''}\n`;

      if (stats.byType.length > 0) {
        text += `\n📊 По типам:\n`;
        for (const item of stats.byType) {
          text += `   ${formatNotificationTypeLabel(item.type)}: ${item.total}`;
          if (item.total - item.delivered > 0) {
            text += ` (✅${item.delivered}/❌${item.total - item.delivered})`;
          }
          text += `\n`;
        }
      }

      text += `\n📋 Последние · Страница ${page + 1}/${pages}\n\n`;

      if (logs.length === 0) {
        text += 'Уведомлений пока нет.';
      } else {
        logs.forEach((log, index) => {
          const num = page * ADMIN_NOTIFICATIONS_PAGE_SIZE + index + 1;
          const status = log.delivered ? '✅' : '❌';
          text += `${num}. ${status} ${formatNotificationTypeLabel(log.type)}\n`;
          text += `   👤 ${formatUserLabel(userMap.get(log.userId), log.userId)}\n`;
          if (log.entityType) {
            const entity = log.entityId ? `${log.entityType} · ${log.entityId.slice(0, 8)}…` : log.entityType;
            text += `   📦 ${entity}\n`;
          }
          if (!log.delivered && log.errorMessage) {
            text += `   ⚠️ ${log.errorMessage.slice(0, 80)}\n`;
          }
          text += `   🕐 ${formatDate(log.createdAt)}\n\n`;
        });
      }

      await safeEditMessageText(ctx, text.trimEnd(), {
        reply_markup: adminPaginatedKeyboard('notifications', page, pages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки уведомлений');
    }
  };
}
