import { Context, Telegraf } from 'telegraf';
import type {
  IUserRepository,
  IPlanRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
} from '../../../domain/interfaces/repositories.js';
import { getEnv } from '../../../shared/config/env.js';
import { formatDate } from '../../../shared/utils/index.js';
import { adminBackKeyboard, adminKeyboard } from '../keyboards.js';

export class AdminHandlers {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
  ) {}

  register(bot: Telegraf): void {
    bot.command('admin', this.handleAdmin);
    bot.action('admin_menu', this.handleAdmin);
    bot.action('admin_users', this.handleAdminUsers);
    bot.action('admin_stats', this.handleAdminStats);
    bot.action('admin_logs', this.handleAdminLogs);
    bot.action('admin_subscriptions', this.handleAdminSubscriptions);
    bot.action('admin_payments', this.handleAdminPayments);
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

  private handleAdminUsers = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const users = await this.userRepo.findAll();
      let text = `👥 Пользователи (${users.length}):\n\n`;
      users.slice(0, 10).forEach((user: any, index: number) => {
        text += `${index + 1}. ${user.firstName} (@${user.username || 'нет'}) - ${formatDate(user.createdAt)}\n`;
      });
      if (users.length > 10) text += `\n... и ещё ${users.length - 10} пользователей`;

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
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

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch {
      await ctx.reply('❌ Ошибка загрузки статистики');
    }
  };

  private handleAdminLogs = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const logs = await this.auditLogRepo.findAll({ limit: 10, order: { createdAt: 'DESC' } });
      let text = `📋 Последние логи (${logs.length}):\n\n`;
      logs.forEach((log: any, index: number) => {
        text += `${index + 1}. ${log.action} - ${log.entityType || ''} (${formatDate(log.createdAt)})\n`;
      });

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch {
      await ctx.reply('❌ Ошибка загрузки логов');
    }
  };

  private handleAdminSubscriptions = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const subscriptions = await this.subscriptionRepo.findAll();
      let text = `💳 Подписки (${subscriptions.length}):\n\n`;
      for (let i = 0; i < Math.min(10, subscriptions.length); i++) {
        const sub: any = subscriptions[i];
        const plan = await this.planRepo.findById(sub.planId);
        const planName = plan?.name || 'Неизвестно';
        text += `${i + 1}. План: ${planName}, Статус: ${sub.status}, До: ${formatDate(sub.endDate)}\n`;
      }
      if (subscriptions.length > 10) text += `\n... и ещё ${subscriptions.length - 10} подписок`;

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch {
      await ctx.reply('❌ Ошибка загрузки подписок');
    }
  };

  private handleAdminPayments = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const payments = await this.paymentRepo.findAll();
      let text = `💰 Платежи (${payments.length}):\n\n`;
      for (let i = 0; i < Math.min(10, payments.length); i++) {
        const payment: any = payments[i];
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

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch {
      await ctx.reply('❌ Ошибка загрузки платежей');
    }
  };

  private handleAdmin = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) {
      await ctx.reply('❌ Доступ запрещен');
      return;
    }

    await ctx.reply('🔧 Админ-панель', {
      reply_markup: adminKeyboard(),
    });
  };
}
