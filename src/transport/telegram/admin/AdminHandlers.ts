import { Context, Telegraf } from 'telegraf';
import type {
  IUserRepository,
  IPlanRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import type { RemnawaveNode } from '../../../shared/types/index.js';
import type { User } from '../../../domain/entities/User.js';
import type { AuditLog } from '../../../domain/entities/AuditLog.js';
import type { Subscription } from '../../../domain/entities/Subscription.js';
import { getEnv } from '../../../shared/config/env.js';
import { formatDate } from '../../../shared/utils/index.js';
import { adminBackKeyboard, adminKeyboard, adminPaginatedKeyboard } from '../keyboards.js';

const ADMIN_USERS_PAGE_SIZE = 10;
const ADMIN_LOGS_PAGE_SIZE = 6;
const ADMIN_SUBS_PAGE_SIZE = 6;

const ACTION_LABELS: Record<string, string> = {
  user_registered: '👤 Регистрация',
  trial_activated: '🆓 Активация trial',
  subscription_purchased: '💎 Покупка подписки',
  subscription_renewed: '🔄 Продление',
  telegram_payment_successful: '💳 Оплата в Telegram',
};

export class AdminHandlers {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
  ) {}

  register(bot: Telegraf): void {
    bot.command('admin', this.handleAdmin);
    bot.action('admin_menu', this.handleAdmin);
    bot.action('admin_users', this.handleAdminUsers);
    bot.action(/^admin_users_p(\d+)$/, this.handleAdminUsers);
    bot.action('admin_stats', this.handleAdminStats);
    bot.action('admin_logs', this.handleAdminLogs);
    bot.action(/^admin_logs_p(\d+)$/, this.handleAdminLogs);
    bot.action('admin_subscriptions', this.handleAdminSubscriptions);
    bot.action(/^admin_subs_p(\d+)$/, this.handleAdminSubscriptions);
    bot.action('admin_payments', this.handleAdminPayments);
    bot.action('admin_servers', this.handleAdminServers);
  }

  private isAdmin(ctx: Context): boolean {
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

  private parsePage(ctx: Context, fallback = 0): number {
    const cbData = ctx.callbackQuery;
    if (!cbData || !('data' in cbData) || !cbData.data) return fallback;

    const match = cbData.data.match(/_p(\d+)$/);
    if (!match?.[1]) return fallback;

    const page = Number.parseInt(match[1], 10);
    return Number.isFinite(page) && page >= 0 ? page : fallback;
  }

  private totalPages(totalItems: number, pageSize: number): number {
    return Math.max(1, Math.ceil(totalItems / pageSize));
  }

  private clampPage(page: number, totalPages: number): number {
    return Math.min(Math.max(0, page), totalPages - 1);
  }

  private formatUserLabel(user: User | null | undefined, userId?: string): string {
    if (user) {
      const name = user.firstName ?? 'Без имени';
      const username = user.username ? `@${user.username}` : 'без username';
      return `${name} (${username}) · TG ${user.telegramId}`;
    }
    if (userId) return `ID ${userId.slice(0, 8)}…`;
    return 'Неизвестный пользователь';
  }

  private formatActionLabel(action: string): string {
    return ACTION_LABELS[action] ?? action;
  }

  private async buildUserMap(userIds: string[]): Promise<Map<string, User>> {
    const uniqueIds = [...new Set(userIds)];
    const users = await Promise.all(uniqueIds.map((id) => this.userRepo.findById(id)));
    const map = new Map<string, User>();
    for (const user of users) {
      if (user) map.set(user.id, user);
    }
    return map;
  }

  private handleAdminUsers = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const users = await this.userRepo.findAll();
      const totalPages = this.totalPages(users.length, ADMIN_USERS_PAGE_SIZE);
      const page = this.clampPage(this.parsePage(ctx), totalPages);
      const slice = users.slice(
        page * ADMIN_USERS_PAGE_SIZE,
        page * ADMIN_USERS_PAGE_SIZE + ADMIN_USERS_PAGE_SIZE,
      );

      let text = `👥 Пользователи\n`;
      text += `Всего: ${users.length} · Страница ${page + 1}/${totalPages}\n\n`;

      if (slice.length === 0) {
        text += 'Список пуст.';
      } else {
        slice.forEach((user, index) => {
          const num = page * ADMIN_USERS_PAGE_SIZE + index + 1;
          text += `${num}. ${this.formatUserLabel(user)}\n`;
          text += `   📅 ${formatDate(user.createdAt)}\n`;
        });
      }

      await ctx.editMessageText(text, {
        reply_markup: adminPaginatedKeyboard('users', page, totalPages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки пользователей');
    }
  };

  private handleAdminStats = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const usersCount = await this.userRepo.count();
      const subscriptionsCount = await this.subscriptionRepo.count();
      const paymentsCount = await this.paymentRepo.count();
      const logsCount = await this.auditLogRepo.count();

      const text = `📊 Статистика:\n\n👥 Пользователей: ${usersCount}\n💳 Подписок: ${subscriptionsCount}\n💰 Платежей: ${paymentsCount}\n📋 Логов: ${logsCount}`;

      await ctx.editMessageText(text, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]],
        },
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки статистики');
    }
  };

  private handleAdminLogs = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const total = await this.auditLogRepo.count();
      const totalPages = this.totalPages(total, ADMIN_LOGS_PAGE_SIZE);
      const page = this.clampPage(this.parsePage(ctx), totalPages);

      const logs = await this.auditLogRepo.findAll({
        limit: ADMIN_LOGS_PAGE_SIZE,
        skip: page * ADMIN_LOGS_PAGE_SIZE,
        order: { createdAt: 'DESC' },
      });

      const userMap = await this.buildUserMap(logs.map((log) => log.userId));

      let text = `📋 Логи действий\n`;
      text += `Всего: ${total} · Страница ${page + 1}/${totalPages}\n\n`;

      if (logs.length === 0) {
        text += 'Логов пока нет.';
      } else {
        logs.forEach((log, index) => {
          text += this.formatLogEntry(log, index + 1, userMap.get(log.userId));
        });
      }

      await ctx.editMessageText(text, {
        reply_markup: adminPaginatedKeyboard('logs', page, totalPages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки логов');
    }
  };

  private formatLogEntry(log: AuditLog, index: number, user?: User): string {
    let block = `${index}. ${this.formatActionLabel(log.action)}\n`;
    block += `   👤 ${this.formatUserLabel(user, log.userId)}\n`;
    if (log.entityType) {
      const entity = log.entityId ? `${log.entityType} · ${log.entityId.slice(0, 8)}…` : log.entityType;
      block += `   📦 ${entity}\n`;
    }
    block += `   🕐 ${formatDate(log.createdAt)}\n`;
    return `${block}\n`;
  }

  private handleAdminSubscriptions = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const subscriptions = await this.subscriptionRepo.findAll();
      const totalPages = this.totalPages(subscriptions.length, ADMIN_SUBS_PAGE_SIZE);
      const page = this.clampPage(this.parsePage(ctx), totalPages);
      const slice = subscriptions.slice(
        page * ADMIN_SUBS_PAGE_SIZE,
        page * ADMIN_SUBS_PAGE_SIZE + ADMIN_SUBS_PAGE_SIZE,
      );

      let text = `💳 Подписки\n`;
      text += `Всего: ${subscriptions.length} · Страница ${page + 1}/${totalPages}\n\n`;

      if (slice.length === 0) {
        text += 'Подписок пока нет.';
      } else {
        for (let i = 0; i < slice.length; i++) {
          const sub = slice[i] as Subscription;
          const num = page * ADMIN_SUBS_PAGE_SIZE + i + 1;
          const plan = sub.plan ?? (await this.planRepo.findById(sub.planId));
          const planName = plan?.name ?? 'Неизвестно';
          const user = sub.user ?? (await this.userRepo.findById(sub.userId));

          text += `${num}. ${this.formatUserLabel(user, sub.userId)}\n`;
          text += `   💎 ${planName} · ${sub.status}\n`;
          text += `   📅 до ${formatDate(sub.endDate)} · 📱 ${sub.usedDevices}/${sub.deviceLimit}\n\n`;
        }
      }

      await ctx.editMessageText(text.trimEnd(), {
        reply_markup: adminPaginatedKeyboard('subs', page, totalPages),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки подписок');
    }
  };

  private formatNodeStatus(node: RemnawaveNode): string {
    if (node.isDisabled) return '⚫ disabled';
    if (node.isConnecting) return '🟡 connecting';
    if (node.isConnected) return '🟢 online';
    return '🔴 offline';
  }

  private formatBitrate(bytesPerSec: number | undefined): string {
    if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec < 0) {
      return '—';
    }
    const mbitPerSec = (bytesPerSec * 8) / 1_000_000;
    if (mbitPerSec >= 10) return `${Math.round(mbitPerSec)} Мбит/с`;
    if (mbitPerSec >= 1) return `${mbitPerSec.toFixed(1)} Мбит/с`;
    const kbitPerSec = (bytesPerSec * 8) / 1_000;
    return kbitPerSec >= 1 ? `${Math.round(kbitPerSec)} Кбит/с` : '0 Мбит/с';
  }

  private formatRamPercent(memoryUsed: number, memoryFree: number): string {
    const total = memoryUsed + memoryFree;
    if (!Number.isFinite(total) || total <= 0) return '—';
    return `${Math.round((memoryUsed / total) * 100)}%`;
  }

  private formatCompactUptime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const days = Math.floor(seconds / 86400);
    if (days > 0) return `${days}д`;
    const hours = Math.floor(seconds / 3600);
    if (hours > 0) return `${hours}ч`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}м`;
  }

  private formatNodeEntry(node: RemnawaveNode): string {
    const stats = node.system?.stats;
    const iface = stats?.interface;
    const rx = this.formatBitrate(iface?.rxBytesPerSec);
    const tx = this.formatBitrate(iface?.txBytesPerSec);

    const line1 = `${node.name} · ${this.formatNodeStatus(node)} · 👥 ${node.usersOnline} · ⬇️ ${rx} ⬆️ ${tx}`;

    if (!stats) {
      return `${line1}\n⚠️ статистика недоступна`;
    }

    const load = stats.loadAvg[0];
    const loadLabel = typeof load === 'number' && Number.isFinite(load) ? load.toFixed(1) : '—';
    const xray = node.versions?.xray ?? '—';
    const line2 = `RAM ${this.formatRamPercent(stats.memoryUsed, stats.memoryFree)} · load ${loadLabel} · xray ${xray} · uptime ${this.formatCompactUptime(stats.uptime)}`;

    return `${line1}\n${line2}`;
  }

  private handleAdminServers = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const nodes = await this.remnawaveService.getNodes();
      const totalUsersOnline = nodes.reduce((sum, node) => sum + node.usersOnline, 0);
      let text = `🖥 Сервера\n`;
      text += `Всего: ${nodes.length}\n`;
      text += `👥 Онлайн: ${totalUsersOnline}\n\n`;

      if (nodes.length === 0) {
        text += 'Серверов пока нет.';
      } else {
        text += nodes.map((node) => this.formatNodeEntry(node)).join('\n\n');
      }

      await ctx.editMessageText(text.trimEnd(), {
        reply_markup: adminBackKeyboard(),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки серверов');
    }
  };

  private handleAdminPayments = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const payments = await this.paymentRepo.findAll();
      let text = `💰 Платежи (${payments.length}):\n\n`;
      for (let i = 0; i < Math.min(10, payments.length); i++) {
        const payment = payments[i];
        if (!payment) continue;
        const userLabel = payment.user?.username
          ? `@${payment.user.username}`
          : payment.user?.firstName || payment.userId;
        const planLabel = payment.plan?.name || payment.planId;
        text +=
          `${i + 1}. ${userLabel} • ${planLabel}\n` +
          `   ${payment.amount} ${payment.currency || ''} • ${payment.provider} • ${payment.status}\n` +
          `   ${formatDate(payment.createdAt)}\n`;
      }
      if (payments.length > 10) text += `\n... и ещё ${payments.length - 10} платежей`;

      await ctx.editMessageText(text, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]],
        },
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки платежей');
    }
  };

  private handleAdmin = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) {
      await ctx.reply('❌ Доступ запрещен');
      return;
    }

    const replyOptions = { reply_markup: adminKeyboard() };

    if (ctx.callbackQuery) {
      await ctx.editMessageText('🔧 Админ-панель v. 1.4', replyOptions);
      return;
    }

    await ctx.reply('🔧 Админ-панель v. 1.4', replyOptions);
  };
}
