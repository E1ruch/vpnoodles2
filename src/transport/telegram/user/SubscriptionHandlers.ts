import { Context, Telegraf } from 'telegraf';
import type { ActivateTrialUseCase } from '../../../application/usecases/ActivateTrialUseCase.js';
import type { GetSubscriptionUseCase } from '../../../application/usecases/GetSubscriptionUseCase.js';
import type { RenewSubscriptionUseCase } from '../../../application/usecases/RenewSubscriptionUseCase.js';
import type {
  IUserRepository,
  IPlanRepository,
  ISubscriptionRepository,
} from '../../../domain/interfaces/repositories.js';
import type { IQRCodeService } from '../../../domain/interfaces/services.js';
import { getLogger } from '../../../shared/logger/index.js';
import { isAppError } from '../../../shared/errors/index.js';
import { formatDate } from '../../../shared/utils/index.js';
import { getEnv } from '../../../shared/config/env.js';
import { Texts } from '../texts.js';
import {
  planSelectionKeyboard,
  paidPlansKeyboard,
  vpnActionsKeyboard,
  trialConfirmKeyboard,
  backToMainKeyboard,
} from '../keyboards.js';

/**
 * Экраны "Мой VPN" / выбор тарифа / активация бесплатного тарифа / продление.
 * Вынесено из BotHandlers при разбиении handlers.ts (был 1147 строк) на модули
 * по доменным группам — код и тексты не менялись, только перенос.
 */
export class SubscriptionHandlers {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private getSubscription: GetSubscriptionUseCase,
    private activateTrial: ActivateTrialUseCase,
    private renewSubscription: RenewSubscriptionUseCase,
    private qrCodeService: IQRCodeService,
  ) {}

  register(bot: Telegraf): void {
    bot.action('my_vpn', this.handleMyVpn);
    bot.action('plans', this.handlePlans);
    bot.action('plan_trial', this.handlePlanTrial);
    bot.action('plan_paid', this.handlePlanPaid);
    bot.action('activate_trial', this.handleActivateTrial);
    bot.action('instructions', this.handleInstructions);
    bot.action(/^renew_(.+)$/, this.handleRenew);
  }

  private handleMyVpn = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const sub = await this.getSubscription.execute(user.id);
      if (!sub) {
        await ctx.editMessageText(Texts.VPN_NOT_FOUND, {
          reply_markup: planSelectionKeyboard(),
        });
        return;
      }

      const text = sub.isExpired
        ? Texts.VPN_EXPIRED
        : Texts.VPN_ACTIVE.replace('{planName}', sub.planName)
            .replace('{endDate}', formatDate(sub.endDate))
            .replace('{usedDevices}', String(sub.usedDevices))
            .replace('{deviceLimit}', String(sub.deviceLimit))
            .replace('{daysLeft}', String(sub.daysLeft))
            .replace('{url}', sub.subscriptionUrl || 'Ссылка недоступна');

      const showRenewButton = sub.planType === 'trial' && sub.daysLeft <= 3;

      await ctx.editMessageText(text, {
        reply_markup: vpnActionsKeyboard(sub.id, sub.isExpired, showRenewButton),
      });
    } catch (err) {
      logger.error({ err }, 'Error in my_vpn handler');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handlePlans = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      await ctx.editMessageText(Texts.CHOOSE_PLAN, {
        reply_markup: planSelectionKeyboard(),
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handlePlanTrial = async (ctx: Context): Promise<void> => {
    try {
      await ctx.editMessageText(Texts.TRIAL_INFO, {
        reply_markup: trialConfirmKeyboard(),
      });
    } catch {
      await ctx.reply(Texts.TRIAL_INFO, { reply_markup: trialConfirmKeyboard() });
    }
  };

  private handlePlanPaid = async (ctx: Context): Promise<void> => {
    try {
      const plans = await this.planRepo.findByType('paid');
      if (plans.length === 0) {
        await ctx.editMessageText('Платные тарифы пока недоступны.', {
          reply_markup: backToMainKeyboard(),
        });
        return;
      }

      await ctx.editMessageText(Texts.PAID_PLANS_INFO, {
        reply_markup: paidPlansKeyboard(plans),
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleActivateTrial = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const result = await this.activateTrial.execute(user.id);

      const qrCode = await this.qrCodeService.generateBase64(result.subscriptionUrl);
      const qrBase64 = qrCode.split(',')[1] ?? '';

      await ctx.editMessageText(Texts.PAYMENT_SUCCESS);
      await ctx.replyWithPhoto(
        { source: Buffer.from(qrBase64, 'base64') },
        { caption: Texts.SUBSCRIPTION_URL.replace('{url}', result.subscriptionUrl) },
      );
      await ctx.reply(Texts.INSTRUCTIONS, { reply_markup: backToMainKeyboard() });
    } catch (err) {
      logger.error({ err }, 'Error activating trial');
      if (isAppError(err)) {
        if (err.code === 'SUBSCRIPTION_ERROR') {
          if (err.message.includes('Use renew')) {
            await ctx.reply(Texts.ERROR_TRIAL_EXISTS, { reply_markup: backToMainKeyboard() });
            return;
          }
          await ctx.reply(Texts.ERROR_ALREADY_ACTIVE, { reply_markup: backToMainKeyboard() });
          return;
        }
      }
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleInstructions = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const sub = await this.getSubscription.execute(user.id);
      if (!sub?.subscriptionUrl) {
        await ctx.editMessageText('У вас нет активной подписки.', {
          reply_markup: backToMainKeyboard(),
        });
        return;
      }

      await ctx.editMessageText(
        Texts.INSTRUCTIONS + '\n\n' + Texts.SUBSCRIPTION_URL.replace('{url}', sub.subscriptionUrl),
        { reply_markup: backToMainKeyboard() },
      );
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleRenew = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const subscriptionId = cbData.data.replace('renew_', '');
      const subscription = await this.subscriptionRepo.findById(subscriptionId);
      if (!subscription || subscription.userId !== user.id) {
        await ctx.reply('Подписка не найдена.', { reply_markup: backToMainKeyboard() });
        return;
      }

      const plan = await this.planRepo.findById(subscription.planId);
      if (!plan) {
        await ctx.reply('Тариф подписки не найден.', { reply_markup: backToMainKeyboard() });
        return;
      }

      if (plan.type === 'trial') {
        const env = getEnv();
        await this.renewSubscription.execute(subscription.id, env.TRIAL_DURATION_DAYS);

        const sub = await this.getSubscription.execute(user.id);
        if (!sub) {
          await ctx.editMessageText(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
          return;
        }

        const text = Texts.VPN_ACTIVE.replace('{planName}', sub.planName)
          .replace('{endDate}', formatDate(sub.endDate))
          .replace('{usedDevices}', String(sub.usedDevices))
          .replace('{deviceLimit}', String(sub.deviceLimit))
          .replace('{daysLeft}', String(sub.daysLeft))
          .replace('{url}', sub.subscriptionUrl || 'Ссылка недоступна');

        const showRenewButton = sub.planType === 'trial' && sub.daysLeft <= 3;
        await ctx.editMessageText(text, {
          reply_markup: vpnActionsKeyboard(sub.id, sub.isExpired, showRenewButton),
        });
        return;
      }

      // Платные подписки продлеваются через оплату
      const plans = await this.planRepo.findByType('paid');
      await ctx.editMessageText(Texts.RENEW_CHOOSE_PLAN, {
        reply_markup: paidPlansKeyboard(plans),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, 'Error in renew handler');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard(), parse_mode: 'Markdown' });
    }
  };
}
