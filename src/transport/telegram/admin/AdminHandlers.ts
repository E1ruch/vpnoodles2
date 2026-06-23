import { Context, Telegraf } from 'telegraf';
import type {
  IUserRepository,
  IPlanRepository,
  ISubscriptionRepository,
  IPaymentRepository,
  IAuditLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import type { RenewSubscriptionUseCase } from '../../../application/usecases/RenewSubscriptionUseCase.js';
import type { SyncAllSubscriptionsFromRemnawaveUseCase } from '../../../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import { MigrateUsersToRemnawaveUseCase } from '../../../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import type { RemnawaveNode } from '../../../shared/types/index.js';
import type { User } from '../../../domain/entities/User.js';
import type { AuditLog } from '../../../domain/entities/AuditLog.js';
import type { Subscription } from '../../../domain/entities/Subscription.js';
import { getEnv } from '../../../shared/config/env.js';
import { formatDate, sleep } from '../../../shared/utils/index.js';
import { getLogger } from '../../../shared/logger/index.js';
import {
  adminBackKeyboard,
  adminBroadcastCancelKeyboard,
  adminBroadcastConfirmKeyboard,
  adminBroadcastKeyboard,
  adminKeyboard,
  adminMigrateConfirmKeyboard,
  adminPaginatedKeyboard,
} from '../keyboards.js';

const ADMIN_USERS_PAGE_SIZE = 10;
const ADMIN_LOGS_PAGE_SIZE = 6;
const ADMIN_SUBS_PAGE_SIZE = 6;
const BROADCAST_GIFT_DAYS = 7;
const BROADCAST_DELAY_MS = 50;

const EXPIRED_GIFT_MESSAGE = `🎁 Приятный сюрприз от VPN Лапша!

Мы продлили вашу подписку на ${BROADCAST_GIFT_DAYS} дней — совершенно бесплатно.

🚀 Снова доступны все серверы и быстрое подключение. Откройте «🌐 Мой VPN» в боте — ссылка уже ждёт вас.

Не упустите момент — загляните сегодня и оцените, как удобно пользоваться VPN без лишних хлопот.

Приятного серфинга! 🍜`;

const MIGRATION_BROADCAST_MESSAGE = `⚠️ Техническое уведомление

Из-за сбоя мы перенесли вашу подписку на новую инфраструктуру.

🎁 В качестве извинений добавили +5 дней к подписке.

🔗 Новая ссылка для подключения:
{url}

Пожалуйста, обновите подписку в VPN-приложении:
1) Удалите старую подписку
2) Добавьте новую ссылку

Если возникнут сложности — напишите в поддержку.`;

const ACTION_LABELS: Record<string, string> = {
  user_registered: '👤 Регистрация',
  trial_activated: '🆓 Активация trial',
  subscription_purchased: '💎 Покупка подписки',
  subscription_renewed: '🔄 Продление',
  telegram_payment_successful: '💳 Оплата в Telegram',
  broadcast_all: '📢 Рассылка всем',
  broadcast_expired_gift: '🎁 Подарок истёкшим',
  sync_remnawave: '🔄 Синхронизация Remnawave',
  migrate_remnawave: '🚚 Миграция в Remnawave',
};

export class AdminHandlers {
  private pendingCustomBroadcast = new Set<number>();

  constructor(
    private bot: Telegraf,
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
    private renewSubscription: RenewSubscriptionUseCase,
    private syncAllFromRemnawave: SyncAllSubscriptionsFromRemnawaveUseCase,
    private migrateUsersToRemnawave: MigrateUsersToRemnawaveUseCase,
  ) {}

  register(bot: Telegraf): void {
    bot.use(this.handleAdminTextMiddleware);
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
    bot.action('admin_broadcast', this.handleAdminBroadcast);
    bot.action('admin_broadcast_all', this.handleAdminBroadcastAll);
    bot.action('admin_broadcast_cancel', this.handleAdminBroadcastCancel);
    bot.action('admin_broadcast_expired', this.handleAdminBroadcastExpired);
    bot.action('admin_broadcast_expired_confirm', this.handleAdminBroadcastExpiredConfirm);
    bot.action('admin_sync', this.handleAdminSync);
    bot.action('admin_migrate_remnawave', this.handleAdminMigrateRemnawave);
    bot.action('admin_migrate_remnawave_confirm', this.handleAdminMigrateRemnawaveConfirm);
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

  private isMessageNotModifiedError(err: unknown): boolean {
    const description =
      err && typeof err === 'object' && 'description' in err
        ? String((err as { description: unknown }).description)
        : err instanceof Error
          ? err.message
          : String(err);
    return description.includes('message is not modified');
  }

  private async safeEditMessageText(
    ctx: Context,
    text: string,
    extra?: Parameters<Context['editMessageText']>[1],
  ): Promise<void> {
    try {
      await ctx.editMessageText(text, extra);
    } catch (err) {
      if (this.isMessageNotModifiedError(err)) {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery().catch(() => undefined);
        }
        return;
      }
      throw err;
    }
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

      await this.safeEditMessageText(ctx,text, {
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

      await this.safeEditMessageText(ctx,text, {
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

      await this.safeEditMessageText(ctx,text, {
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

      await this.safeEditMessageText(ctx,text.trimEnd(), {
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

      await this.safeEditMessageText(ctx,text.trimEnd(), {
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

      await this.safeEditMessageText(ctx,text, {
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

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);

    const replyOptions = { reply_markup: adminKeyboard() };

    if (ctx.callbackQuery) {
      await this.safeEditMessageText(ctx,'🔧 Админ-панель v. 1.7', replyOptions);
      return;
    }

    await ctx.reply('🔧 Админ-панель v. 1.7', replyOptions);
  };

  private handleAdminSync = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    await this.safeEditMessageText(
      ctx,
      '⏳ Синхронизация с Remnawave…\n\nПодтягиваем даты, статусы, устройства и ссылки подписок в БД.',
      { reply_markup: adminBackKeyboard() },
    );

    try {
      const result = await this.syncAllFromRemnawave.execute();

      const adminUser = await this.userRepo.findByTelegramId(adminId);
      if (adminUser) {
        await this.auditLogRepo.create({
          userId: adminUser.id,
          action: 'sync_remnawave',
          entityType: 'sync',
          metadata: { ...result } as Record<string, unknown>,
        });
      }

      const text = `🔄 Синхронизация завершена

Источник: Remnawave → БД

📋 Подписок в БД: ${result.totalSubscriptions}
🔗 С Remnawave ID: ${result.remnawaveUsers}
✅ Обновлено записей: ${result.updatedSubscriptions}
👤 Пользователей Remnawave: ${result.syncedRemnawaveUsers}${result.failedRemnawaveUsers > 0 ? `\n❌ Ошибок: ${result.failedRemnawaveUsers}` : ''}${result.skippedNoRemnawave > 0 ? `\n⏭ Без Remnawave: ${result.skippedNoRemnawave}` : ''}`;

      await this.safeEditMessageText(ctx, text, { reply_markup: adminKeyboard() });
    } catch {
      await this.safeEditMessageText(ctx, '❌ Ошибка синхронизации с Remnawave', {
        reply_markup: adminKeyboard(),
      });
    }
  };

  private handleAdminMigrateRemnawave = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    try {
      const subscriptions = await this.subscriptionRepo.findAll();
      const userCount = new Set(subscriptions.map((sub) => sub.userId)).size;
      const bonusDays = MigrateUsersToRemnawaveUseCase.MIGRATION_BONUS_DAYS;

      const text = `🚚 Миграция в Remnawave

⚠️ Операция необратима и затронет всех пользователей с подписками.

Что произойдёт:
• пересоздание/обновление пользователей в Remnawave
• +${bonusDays} дней к подписке каждому
• новые ссылки подписки в БД
• рассылка уведомлений всем мигрированным

👥 Пользователей к обработке: ${userCount}

Продолжить?`;

      await this.safeEditMessageText(ctx, text, { reply_markup: adminMigrateConfirmKeyboard() });
    } catch {
      await ctx.reply('❌ Ошибка подготовки миграции', { reply_markup: adminKeyboard() });
    }
  };

  private handleAdminMigrateRemnawaveConfirm = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    await this.safeEditMessageText(
      ctx,
      '⏳ Запускаю миграцию в Remnawave…\n\nПереносим подписки, добавляем +5 дней всем, обновляем ссылки и отправляем уведомления.',
      { reply_markup: adminBackKeyboard() },
    );

    try {
      const migration = await this.migrateUsersToRemnawave.execute();
      const { sent, failed } = await this.sendMigrationBroadcast(migration.recipients);

      const adminUser = await this.userRepo.findByTelegramId(adminId);
      if (adminUser) {
        await this.auditLogRepo.create({
          userId: adminUser.id,
          action: 'migrate_remnawave',
          entityType: 'migration',
          metadata: {
            totalUsers: migration.totalUsers,
            migratedUsers: migration.migratedUsers,
            failedUsers: migration.failedUsers,
            skippedUsers: migration.skippedUsers,
            recipients: migration.recipients.length,
            sent,
            sendFailed: failed,
          },
        });
      }

      const text = `✅ Миграция завершена

🎁 Бонус: +5 дней всем пользователям

🚚 Перенос в Remnawave:
👥 Пользователей в обработке: ${migration.totalUsers}
✅ Успешно мигрировано: ${migration.migratedUsers}
⏭ Пропущено: ${migration.skippedUsers}${migration.failedUsers > 0 ? `\n❌ Ошибок миграции: ${migration.failedUsers}` : ''}

📢 Уведомления пользователям:
📨 Отправлено: ${sent}${failed > 0 ? `\n❌ Ошибок отправки: ${failed}` : ''}`;

      await this.safeEditMessageText(ctx, text, { reply_markup: adminKeyboard() });
    } catch (err) {
      getLogger().error({ err }, 'Remnawave migration failed');
      await this.safeEditMessageText(ctx, '❌ Ошибка миграции в Remnawave', {
        reply_markup: adminKeyboard(),
      });
    }
  };

  private handleAdminBroadcast = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);

    const text = `📢 Рассылка

Выберите тип рассылки:

✉️ Текст всем — отправить своё сообщение каждому пользователю бота.

🎁 Подарок истёкшим — продлить подписку на ${BROADCAST_GIFT_DAYS} дней и отправить заготовленное сообщение только тем, у кого подписка истекла.`;

    await this.safeEditMessageText(ctx,text, { reply_markup: adminBroadcastKeyboard() });
  };

  private handleAdminBroadcastAll = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    this.pendingCustomBroadcast.add(adminId);

    const usersCount = await this.userRepo.count();
    const text = `✉️ Рассылка всем

Получателей: ${usersCount}

Отправьте следующим сообщением текст рассылки.`;

    await this.safeEditMessageText(ctx,text, { reply_markup: adminBroadcastCancelKeyboard() });
  };

  private handleAdminBroadcastCancel = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);
    await this.handleAdminBroadcast(ctx);
  };

  private handleAdminTextMiddleware = async (ctx: Context, next: () => Promise<void>): Promise<void> => {
    const adminId = ctx.from?.id;
    if (!adminId || !this.isAdmin(ctx) || !this.pendingCustomBroadcast.has(adminId)) {
      return next();
    }

    const message = ctx.message;
    if (!message || !('text' in message) || !message.text) {
      return next();
    }

    if (message.text.startsWith('/')) {
      return next();
    }

    this.pendingCustomBroadcast.delete(adminId);
    await this.runBroadcastAll(ctx, message.text);
  };

  private handleAdminBroadcastExpired = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);

    const expired = await this.findUsersWithExpiredSubscription();
    const text =
      expired.length === 0
        ? `🎁 Подарок истёкшим

Получателей: 0

Сейчас нет пользователей с истёкшей подпиской в БД.`
        : `🎁 Подарок истёкшим

Получателей: ${expired.length}
Действие: продление на ${BROADCAST_GIFT_DAYS} дней + сообщение

Текст сообщения:
${EXPIRED_GIFT_MESSAGE}`;

    await this.safeEditMessageText(ctx, text, {
      reply_markup: expired.length > 0 ? adminBroadcastConfirmKeyboard() : adminBackKeyboard(),
    });
  };

  private handleAdminBroadcastExpiredConfirm = async (ctx: Context): Promise<void> => {
    if (!this.isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    await this.safeEditMessageText(ctx,'⏳ Запускаю рассылку истёкшим…', {
      reply_markup: adminBackKeyboard(),
    });

    const expired = await this.findUsersWithExpiredSubscription();
    let renewed = 0;
    let renewFailed = 0;
    let sent = 0;
    let sendFailed = 0;

    for (const { user, subscription } of expired) {
      try {
        await this.renewSubscription.execute(subscription.id, BROADCAST_GIFT_DAYS);
        renewed++;
      } catch (err) {
        renewFailed++;
        getLogger().warn({ err, userId: user.id, subscriptionId: subscription.id }, 'Gift renew failed');
        continue;
      }

      try {
        await this.bot.telegram.sendMessage(Number(user.telegramId), EXPIRED_GIFT_MESSAGE);
        sent++;
      } catch (err) {
        sendFailed++;
        getLogger().warn({ err, telegramId: user.telegramId }, 'Gift broadcast send failed');
      }

      await sleep(BROADCAST_DELAY_MS);
    }

    const adminUser = await this.userRepo.findByTelegramId(adminId);
    if (adminUser) {
      await this.auditLogRepo.create({
        userId: adminUser.id,
        action: 'broadcast_expired_gift',
        entityType: 'broadcast',
        metadata: {
          recipients: expired.length,
          renewed,
          renewFailed,
          sent,
          sendFailed,
          giftDays: BROADCAST_GIFT_DAYS,
        },
      });
    }

    const report = `✅ Рассылка завершена

👥 Получателей: ${expired.length}
🔄 Продлено: ${renewed}${renewFailed > 0 ? ` (ошибок: ${renewFailed})` : ''}
📨 Отправлено: ${sent}${sendFailed > 0 ? ` (ошибок: ${sendFailed})` : ''}`;

    await this.safeEditMessageText(ctx,report, { reply_markup: adminBroadcastKeyboard() });
  };

  private async findUsersWithExpiredSubscription(): Promise<
    Array<{ user: User; subscription: Subscription }>
  > {
    const now = new Date();
    const users = await this.userRepo.findAll();
    const result: Array<{ user: User; subscription: Subscription }> = [];

    for (const user of users) {
      const active = await this.subscriptionRepo.findActiveByUserId(user.id);
      if (active && active.endDate > now) continue;

      const subscriptions = await this.subscriptionRepo.findByUserId(user.id);
      if (subscriptions.length === 0) continue;

      const latest = subscriptions.sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0];
      if (!latest) continue;

      const isExpired = latest.status === 'expired' || latest.endDate <= now;
      if (isExpired) {
        result.push({ user, subscription: latest });
      }
    }

    return result;
  }

  private runBroadcastAll = async (ctx: Context, text: string): Promise<void> => {
    const adminId = ctx.from?.id;
    if (!adminId) return;

    await ctx.reply('⏳ Отправляю рассылку…');

    const users = await this.userRepo.findAll();
    const telegramIds = users.map((u) => Number(u.telegramId));

    const { sent, failed } = await this.sendTelegramMessages(telegramIds, text);

    const adminUser = await this.userRepo.findByTelegramId(adminId);
    if (adminUser) {
      await this.auditLogRepo.create({
        userId: adminUser.id,
        action: 'broadcast_all',
        entityType: 'broadcast',
        metadata: { recipients: users.length, sent, failed },
      });
    }

    await ctx.reply(
      `✅ Рассылка завершена\n\n👥 Всего: ${users.length}\n📨 Отправлено: ${sent}${failed > 0 ? `\n❌ Ошибок: ${failed}` : ''}`,
      { reply_markup: adminBroadcastKeyboard() },
    );
  };

  private async sendTelegramMessages(
    telegramIds: number[],
    text: string,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const telegramId of telegramIds) {
      try {
        await this.bot.telegram.sendMessage(telegramId, text);
        sent++;
      } catch (err) {
        failed++;
        getLogger().warn({ err, telegramId }, 'Broadcast send failed');
      }
      await sleep(BROADCAST_DELAY_MS);
    }

    return { sent, failed };
  }

  private async sendMigrationBroadcast(
    recipients: Array<{ telegramId: number; subscriptionUrl: string }>,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        const text = MIGRATION_BROADCAST_MESSAGE.replace('{url}', recipient.subscriptionUrl);
        await this.bot.telegram.sendMessage(recipient.telegramId, text);
        sent++;
      } catch (err) {
        failed++;
        getLogger().warn({ err, telegramId: recipient.telegramId }, 'Migration broadcast send failed');
      }
      await sleep(BROADCAST_DELAY_MS);
    }

    return { sent, failed };
  }
}
