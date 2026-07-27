import { Context, Telegraf } from 'telegraf';
import type {
  IUserRepository,
  ISubscriptionRepository,
  IAuditLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { RenewSubscriptionUseCase } from '../../../application/usecases/RenewSubscriptionUseCase.js';
import type { DeactivateBlockedUserUseCase } from '../../../application/usecases/DeactivateBlockedUserUseCase.js';
import type { User } from '../../../domain/entities/User.js';
import type { Subscription } from '../../../domain/entities/Subscription.js';
import { getLogger } from '../../../shared/logger/index.js';
import { sleep } from '../../../shared/utils/index.js';
import { isTelegramBlockedError } from '../../../infrastructure/notifications/telegramErrors.js';
import {
  adminBackKeyboard,
  adminBroadcastCancelKeyboard,
  adminBroadcastConfirmKeyboard,
  adminBroadcastKeyboard,
} from '../keyboards.js';
import { isAdmin, safeEditMessageText, BROADCAST_DELAY_MS } from './adminShared.js';

const BROADCAST_GIFT_DAYS = 7;

const EXPIRED_GIFT_MESSAGE = `🎁 Приятный сюрприз от VPN Лапша!

Мы продлили вашу подписку на ${BROADCAST_GIFT_DAYS} дней — совершенно бесплатно.

🚀 Снова доступны все серверы и быстрое подключение. Откройте «🌐 Мой VPN» в боте — ссылка уже ждёт вас.

Не упустите момент — загляните сегодня и оцените, как удобно пользоваться VPN без лишних хлопот.

Приятного серфинга! 🍜`;

/**
 * Рассылки: произвольный текст всем пользователям и «подарок истёкшим»
 * (продление + сообщение). Вынесено из AdminHandlers при разбиении файла
 * (был 920 строк) на модули по доменным группам — код и тексты не менялись,
 * только перенос.
 */
export class AdminBroadcastHandlers {
  constructor(
    private bot: Telegraf,
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private renewSubscription: RenewSubscriptionUseCase,
    private deactivateBlockedUser: DeactivateBlockedUserUseCase,
    /** Общий с AdminOverviewHandlers Set — открытие меню сбрасывает ожидание текста рассылки. */
    private pendingCustomBroadcast: Set<number>,
  ) {}

  register(bot: Telegraf): void {
    bot.use(this.handleAdminTextMiddleware);
    bot.action('admin_broadcast', this.handleAdminBroadcast);
    bot.action('admin_broadcast_all', this.handleAdminBroadcastAll);
    bot.action('admin_broadcast_cancel', this.handleAdminBroadcastCancel);
    bot.action('admin_broadcast_expired', this.handleAdminBroadcastExpired);
    bot.action('admin_broadcast_expired_confirm', this.handleAdminBroadcastExpiredConfirm);
  }

  private handleAdminBroadcast = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);

    const text = `📢 Рассылка

Выберите тип рассылки:

✉️ Текст всем — отправить своё сообщение каждому пользователю бота.

🎁 Подарок истёкшим — продлить подписку на ${BROADCAST_GIFT_DAYS} дней и отправить заготовленное сообщение только тем, у кого подписка истекла.`;

    await safeEditMessageText(ctx, text, { reply_markup: adminBroadcastKeyboard() });
  };

  private handleAdminBroadcastAll = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    this.pendingCustomBroadcast.add(adminId);

    const usersCount = await this.userRepo.count();
    const text = `✉️ Рассылка всем

Получателей: ${usersCount}

Отправьте следующим сообщением текст рассылки.`;

    await safeEditMessageText(ctx, text, { reply_markup: adminBroadcastCancelKeyboard() });
  };

  private handleAdminBroadcastCancel = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);
    await this.handleAdminBroadcast(ctx);
  };

  private handleAdminTextMiddleware = async (ctx: Context, next: () => Promise<void>): Promise<void> => {
    const adminId = ctx.from?.id;
    if (!adminId || !isAdmin(ctx) || !this.pendingCustomBroadcast.has(adminId)) {
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
    if (!isAdmin(ctx)) return;

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

    await safeEditMessageText(ctx, text, {
      reply_markup: expired.length > 0 ? adminBroadcastConfirmKeyboard() : adminBackKeyboard(),
    });
  };

  private handleAdminBroadcastExpiredConfirm = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    await safeEditMessageText(ctx, '⏳ Запускаю рассылку истёкшим…', {
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
        if (isTelegramBlockedError(err)) {
          await this.deactivateBlockedUser.execute(user.id).catch((deactivateErr) => {
            getLogger().error(
              { err: deactivateErr, userId: user.id },
              'Failed to deactivate blocked user',
            );
          });
        }
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

    await safeEditMessageText(ctx, report, { reply_markup: adminBroadcastKeyboard() });
  };

  private async findUsersWithExpiredSubscription(): Promise<
    Array<{ user: User; subscription: Subscription }>
  > {
    const now = new Date();
    const users = await this.userRepo.findAll();
    const result: Array<{ user: User; subscription: Subscription }> = [];

    for (const user of users) {
      // Уже известно, что бот заблокирован — не тратим продление на недостижимого.
      if (user.isActive === false) continue;

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

    const allUsers = await this.userRepo.findAll();
    // Уже известно, что бот заблокирован — не тратим попытку отправки впустую.
    const recipients = allUsers.filter((u) => u.isActive !== false);

    const { sent, failed } = await this.sendTelegramMessages(recipients, text);

    const adminUser = await this.userRepo.findByTelegramId(adminId);
    if (adminUser) {
      await this.auditLogRepo.create({
        userId: adminUser.id,
        action: 'broadcast_all',
        entityType: 'broadcast',
        metadata: { recipients: recipients.length, sent, failed },
      });
    }

    await ctx.reply(
      `✅ Рассылка завершена\n\n👥 Всего: ${recipients.length}\n📨 Отправлено: ${sent}${failed > 0 ? `\n❌ Ошибок: ${failed}` : ''}`,
      { reply_markup: adminBroadcastKeyboard() },
    );
  };

  private async sendTelegramMessages(
    recipients: Array<{ id: string; telegramId: number }>,
    text: string,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        await this.bot.telegram.sendMessage(recipient.telegramId, text);
        sent++;
      } catch (err) {
        failed++;
        getLogger().warn({ err, telegramId: recipient.telegramId }, 'Broadcast send failed');
        if (isTelegramBlockedError(err)) {
          await this.deactivateBlockedUser.execute(recipient.id).catch((deactivateErr) => {
            getLogger().error(
              { err: deactivateErr, userId: recipient.id },
              'Failed to deactivate blocked user',
            );
          });
        }
      }
      await sleep(BROADCAST_DELAY_MS);
    }

    return { sent, failed };
  }
}
