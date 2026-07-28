import { Context, Telegraf } from 'telegraf';
import type { IPaymentRepository } from '../../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import type { RemnawaveNode } from '../../../shared/types/index.js';
import type { GetAdminOverviewUseCase } from '../../../application/usecases/GetAdminOverviewUseCase.js';
import { formatDate } from '../../../shared/utils/index.js';
import { adminKeyboard, adminBackKeyboard } from '../keyboards.js';
import { isAdmin, safeEditMessageText } from './adminShared.js';

/**
 * Главное меню админки, общая статистика, список серверов Remnawave, последние
 * платежи. Вынесено из AdminHandlers при разбиении файла (был 920 строк) на
 * модули по доменным группам — код и тексты не менялись, только перенос.
 */
export class AdminOverviewHandlers {
  constructor(
    private paymentRepo: IPaymentRepository,
    private remnawaveService: IRemnawaveService,
    /** Общий с AdminBroadcastHandlers Set — открытие меню сбрасывает ожидание текста рассылки. */
    private pendingCustomBroadcast: Set<number>,
    private getAdminOverview: GetAdminOverviewUseCase,
  ) {}

  register(bot: Telegraf): void {
    bot.command('admin', this.handleAdmin);
    bot.action('admin_menu', this.handleAdmin);
    bot.action('admin_stats', this.handleAdminStats);
    bot.action('admin_servers', this.handleAdminServers);
    bot.action('admin_payments', this.handleAdminPayments);
  }

  private handleAdmin = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) {
      await ctx.reply('❌ Доступ запрещен');
      return;
    }

    this.pendingCustomBroadcast.delete(ctx.from?.id ?? 0);

    const replyOptions = { reply_markup: adminKeyboard() };

    if (ctx.callbackQuery) {
      await safeEditMessageText(ctx, '🔧 Админ-панель v. 1.8', replyOptions);
      return;
    }

    await ctx.reply('🔧 Админ-панель v. 1.8', replyOptions);
  };

  private handleAdminStats = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

    try {
      const overview = await this.getAdminOverview.execute();

      const text = `📊 Статистика:\n\n👥 Пользователей: ${overview.usersCount}\n💳 Подписок: ${overview.subscriptionsCount}\n💰 Платежей: ${overview.paymentsCount}\n📋 Логов: ${overview.logsCount}`;

      await safeEditMessageText(ctx, text, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]],
        },
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки статистики');
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
    if (!isAdmin(ctx)) return;

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

      await safeEditMessageText(ctx, text.trimEnd(), {
        reply_markup: adminBackKeyboard(),
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки серверов');
    }
  };

  private handleAdminPayments = async (ctx: Context): Promise<void> => {
    if (!isAdmin(ctx)) return;

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

      await safeEditMessageText(ctx, text, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Назад в админ-панель', callback_data: 'admin_menu' }]],
        },
      });
    } catch {
      await ctx.reply('❌ Ошибка загрузки платежей');
    }
  };
}
