import { Context, Telegraf } from 'telegraf';
import type { RegisterUserUseCase } from '../../application/usecases/RegisterUserUseCase.js';
import type { ActivateTrialUseCase } from '../../application/usecases/ActivateTrialUseCase.js';
import type { GetSubscriptionUseCase } from '../../application/usecases/GetSubscriptionUseCase.js';
import type { PurchasePlanUseCase } from '../../application/usecases/PurchasePlanUseCase.js';
import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { IQRCodeService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';
import { isAppError } from '../../shared/errors/index.js';
import { formatDate, formatCurrency } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';
import { Texts } from './texts.js';
import {
  mainMenuKeyboard,
  planSelectionKeyboard,
  paidPlansKeyboard,
  vpnActionsKeyboard,
  trialConfirmKeyboard,
  backToMainKeyboard,
} from './keyboards.js';
import { YooKassaService } from '../../infrastructure/payments/YooKassaService.js';

export class BotHandlers {
  private bot: Telegraf;
  private registerUser: RegisterUserUseCase;
  private activateTrial: ActivateTrialUseCase;
  private getSubscription: GetSubscriptionUseCase;
  private purchasePlan: PurchasePlanUseCase;
  private userRepo: IUserRepository;
  private planRepo: IPlanRepository;
  private qrCodeService: IQRCodeService;
  private yooKassaService: YooKassaService;

  constructor(
    bot: Telegraf,
    registerUser: RegisterUserUseCase,
    activateTrial: ActivateTrialUseCase,
    getSubscription: GetSubscriptionUseCase,
    purchasePlan: PurchasePlanUseCase,
    userRepo: IUserRepository,
    planRepo: IPlanRepository,
    qrCodeService: IQRCodeService,
  ) {
    this.bot = bot;
    this.registerUser = registerUser;
    this.activateTrial = activateTrial;
    this.getSubscription = getSubscription;
    this.purchasePlan = purchasePlan;
    this.userRepo = userRepo;
    this.planRepo = planRepo;
    this.qrCodeService = qrCodeService;
    this.yooKassaService = new YooKassaService();
  }

  register(): void {
    this.bot.start(this.handleStart);
    this.bot.action('back_main', this.handleBackMain);
    this.bot.action('my_vpn', this.handleMyVpn);
    this.bot.action('plans', this.handlePlans);
    this.bot.action('plan_trial', this.handlePlanTrial);
    this.bot.action('plan_paid', this.handlePlanPaid);
    this.bot.action('activate_trial', this.handleActivateTrial);
    this.bot.action('instructions', this.handleInstructions);
    this.bot.action('profile', this.handleProfile);
    this.bot.action('support', this.handleSupport);
    this.bot.action(/^buy_(.+)$/, this.handleBuyPlan);
    this.bot.action(/^renew_(.+)$/, this.handleRenew);
    this.bot.action(/^pay_(stars|yookassa)_(.+)$/, this.handlePaymentMethod);

    // Telegram Stars payment handlers
    this.bot.on('pre_checkout_query', this.handlePreCheckout);
    this.bot.on('successful_payment', this.handleSuccessfulPayment);

    // Global error handler
    this.bot.catch((err) => {
      const logger = getLogger();
      logger.error({ err }, 'Bot error');
    });
  }

  private handleStart = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const userId = await this.registerUser.execute(
        telegramUser.id,
        telegramUser.username ?? null,
        telegramUser.first_name ?? null,
      );

      const user = await this.userRepo.findById(userId);

      const sub = await this.getSubscription.execute(userId);

      const firstName = user?.firstName ?? telegramUser.first_name ?? 'Пользователь';

      if (sub) {
        const welcomeText = Texts.WELCOME_BACK_NAME.replace('{firstName}', firstName);
        await ctx.reply(welcomeText, { reply_markup: mainMenuKeyboard() });
      } else {
        const welcomeText = Texts.WELCOME.replace('{firstName}', firstName);
        await ctx.reply(welcomeText, { reply_markup: planSelectionKeyboard() });
      }
    } catch (err) {
      logger.error({ err }, 'Error in /start handler');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleBackMain = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const firstName = user.firstName ?? telegramUser.first_name ?? 'Пользователь';
      const welcomeText = Texts.WELCOME_BACK_NAME.replace('{firstName}', firstName);
      
      await ctx.editMessageText(welcomeText, {
        reply_markup: mainMenuKeyboard(),
      });
    } catch {
      await ctx.reply(Texts.WELCOME_BACK, { reply_markup: mainMenuKeyboard() });
    }
  };

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
            .replace('{daysLeft}', String(sub.daysLeft));

      await ctx.editMessageText(text, {
        reply_markup: vpnActionsKeyboard(sub.id, sub.isExpired),
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
          await ctx.reply(Texts.ERROR_ALREADY_ACTIVE, { reply_markup: backToMainKeyboard() });
          return;
        }
      }
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleBuyPlan = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;
      const planId = cbData.data.replace('buy_', '');

      const plan = await this.planRepo.findById(planId);
      if (!plan) {
        await ctx.reply('Тариф не найден.', { reply_markup: backToMainKeyboard() });
        return;
      }

      logger.info({ planId, planName: plan.name }, 'Showing payment options');

      // Показываем выбор способа оплаты
      const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

      // Telegram Stars (если цена указана)
      if (plan.priceStars > 0) {
        buttons.push([{ text: `⭐ Telegram Stars (${plan.priceStars})`, callback_data: `pay_stars_${planId}` }]);
      }

      // YooKassa (если настроена)
      if (this.yooKassaService.isConfigured()) {
        buttons.push([{ text: `💳 Картой (${formatCurrency(plan.priceRub)})`, callback_data: `pay_yookassa_${planId}` }]);
      }

      buttons.push([{ text: '◀️ Назад', callback_data: 'plan_paid' }]);

      await ctx.editMessageText(
        `💳 Выберите способ оплаты для тарифа "${plan.name}":\n\n` +
        `📅 Срок: ${plan.durationDays} дней\n` +
        `📱 Устройств: до ${plan.deviceLimit}`,
        { reply_markup: { inline_keyboard: buttons } }
      );
    } catch (err) {
      logger.error({ err }, 'Error showing payment options');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handlePaymentMethod = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      // Parse: pay_stars_planId или pay_yookassa_planId
      const match = cbData.data.match(/^pay_(stars|yookassa)_(.+)$/);
      if (!match) return;

      const provider = match[1];
      const planId = match[2];

      if (!planId) return;

      const plan = await this.planRepo.findById(planId);
      if (!plan) {
        await ctx.reply('Тариф не найден.', { reply_markup: backToMainKeyboard() });
        return;
      }

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user || !user.id) return;

      if (provider === 'stars') {
        // Telegram Stars инвойс
        await ctx.replyWithInvoice({
          title: plan.name,
          description: `Подписка на ${plan.durationDays} дней. До ${plan.deviceLimit} устройств.`,
          payload: `plan_${planId}`,
          currency: 'XTR',
          prices: [{ label: plan.name, amount: plan.priceStars }],
          provider_token: '',
        });
      } else if (provider === 'yookassa') {
        // YooKassa платёж
        const result = await this.yooKassaService.createPayment({
          userId: user.id,
          planId: planId,
          planName: plan.name,
          amount: plan.priceRub,
          currency: 'RUB',
          description: `VPN ${plan.name} - ${plan.durationDays} дней`,
        });

        if (result.url) {
          await ctx.reply(
            `💳 Для оплаты перейдите по ссылке:\n\n${result.url}\n\n` +
            `После оплаты подписка активируется автоматически.`,
            { reply_markup: backToMainKeyboard() }
          );
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error processing payment method');
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

  private handleProfile = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const sub = await this.getSubscription.execute(user.id);
      const status = sub ? (sub.isExpired ? 'Не активно' : 'Активно') : 'Нет подписки';

      const text = Texts.PROFILE.replace('{telegramId}', String(user.telegramId))
        .replace('{firstName}', user.firstName ?? 'Не указано')
        .replace('{status}', status)
        .replace('{regDate}', formatDate(user.createdAt));

      await ctx.editMessageText(text, { reply_markup: backToMainKeyboard() });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleSupport = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    try {
      await ctx.editMessageText(Texts.SUPPORT.replace('{supportUsername}', env.SUPPORT_USERNAME), {
        reply_markup: backToMainKeyboard(),
      });
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

      // Show plans for renewal
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

  private handlePreCheckout = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      logger.error({ err }, 'Error in pre_checkout');
      await ctx.answerPreCheckoutQuery(false, 'Ошибка обработки платежа');
    }
  };

  private handleSuccessfulPayment = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const payment = ctx.message;
      if (!payment || !('successful_payment' in payment)) return;

      const payload = payment.successful_payment.invoice_payload;
      const planId = payload.replace('plan_', '');

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const result = await this.purchasePlan.execute(user.id, planId, 'stars');

      await ctx.reply(Texts.PAYMENT_SUCCESS);

      const qrCode = await this.qrCodeService.generateBase64(result.subscriptionUrl);
      const qrBase64 = qrCode.split(',')[1] ?? '';
      await ctx.replyWithPhoto(
        { source: Buffer.from(qrBase64, 'base64') },
        { caption: Texts.SUBSCRIPTION_URL.replace('{url}', result.subscriptionUrl) },
      );
      await ctx.reply(Texts.INSTRUCTIONS, { reply_markup: backToMainKeyboard() });
    } catch (err) {
      logger.error({ err }, 'Error processing successful payment');
      if (isAppError(err)) {
        if (err.code === 'SUBSCRIPTION_ERROR') {
          await ctx.reply(Texts.ERROR_ALREADY_ACTIVE, { reply_markup: backToMainKeyboard() });
          return;
        }
      }
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };
}