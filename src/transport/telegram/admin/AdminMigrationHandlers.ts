import { Context, Telegraf } from 'telegraf';
import type {
  IUserRepository,
  ISubscriptionRepository,
  IAuditLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { SyncAllSubscriptionsFromRemnawaveUseCase } from '../../../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import { MigrateUsersToRemnawaveUseCase } from '../../../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';
import { sleep } from '../../../shared/utils/index.js';
import { adminBackKeyboard, adminKeyboard, adminMigrateConfirmKeyboard } from '../keyboards.js';
import { isAdmin, safeEditMessageText, BROADCAST_DELAY_MS } from './adminShared.js';

const MIGRATION_BROADCAST_MESSAGE = `⚠️ Техническое уведомление

Из-за сбоя мы перенесли вашу подписку на новую инфраструктуру.

🎁 В качестве извинений добавили +5 дней к подписке.

🔗 Новая ссылка для подключения:
{url}

Пожалуйста, обновите подписку в VPN-приложении:
1) Удалите старую подписку
2) Добавьте новую ссылку

Если возникнут сложности — напишите в поддержку.`;

/**
 * Синхронизация данных с Remnawave и одноразовая миграция пользователей в неё.
 * Вынесено из AdminHandlers при разбиении файла (был 920 строк) на модули по
 * доменным группам — код и тексты не менялись, только перенос.
 */
export class AdminMigrationHandlers {
  constructor(
    private bot: Telegraf,
    private userRepo: IUserRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private auditLogRepo: IAuditLogRepository,
    private syncAllFromRemnawave: SyncAllSubscriptionsFromRemnawaveUseCase,
    private migrateUsersToRemnawave: MigrateUsersToRemnawaveUseCase,
  ) {}

  register(bot: Telegraf): void {
    bot.action('admin_sync', this.handleAdminSync);
    bot.action('admin_migrate_remnawave', this.handleAdminMigrateRemnawave);
    bot.action('admin_migrate_remnawave_confirm', this.handleAdminMigrateRemnawaveConfirm);
  }

  private handleAdminSync = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    await safeEditMessageText(
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

      await safeEditMessageText(ctx, text, { reply_markup: adminKeyboard() });
    } catch {
      await safeEditMessageText(ctx, '❌ Ошибка синхронизации с Remnawave', {
        reply_markup: adminKeyboard(),
      });
    }
  };

  private handleAdminMigrateRemnawave = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

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

      await safeEditMessageText(ctx, text, { reply_markup: adminMigrateConfirmKeyboard() });
    } catch {
      await ctx.reply('❌ Ошибка подготовки миграции', { reply_markup: adminKeyboard() });
    }
  };

  private handleAdminMigrateRemnawaveConfirm = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    const adminId = ctx.from?.id;
    if (!adminId) return;

    await safeEditMessageText(
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

      await safeEditMessageText(ctx, text, { reply_markup: adminKeyboard() });
    } catch (err) {
      getLogger().error({ err }, 'Remnawave migration failed');
      await safeEditMessageText(ctx, '❌ Ошибка миграции в Remnawave', {
        reply_markup: adminKeyboard(),
      });
    }
  };

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
