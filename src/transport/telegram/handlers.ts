import { Context, Telegraf } from 'telegraf';
import type { RegisterUserUseCase } from '../../application/usecases/RegisterUserUseCase.js';
import type { ActivateTrialUseCase } from '../../application/usecases/ActivateTrialUseCase.js';
import type { GetSubscriptionUseCase } from '../../application/usecases/GetSubscriptionUseCase.js';
import type { PurchasePlanUseCase } from '../../application/usecases/PurchasePlanUseCase.js';
import type { RenewSubscriptionUseCase } from '../../application/usecases/RenewSubscriptionUseCase.js';
import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { IQRCodeService } from '../../domain/interfaces/services.js';
import type { IPaymentService } from '../../domain/interfaces/services.js';
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
  adminKeyboard,
  adminBackKeyboard,
} from './keyboards.js';
import { YooKassaService } from '../../infrastructure/payments/YooKassaService.js';

export class BotHandlers {
  private bot: Telegraf;
  private registerUser: RegisterUserUseCase;
  private activateTrial: ActivateTrialUseCase;
  private getSubscription: GetSubscriptionUseCase;
  private purchasePlan: PurchasePlanUseCase;
  private renewSubscription: RenewSubscriptionUseCase;
  private userRepo: IUserRepository;
  private planRepo: IPlanRepository;
  private subscriptionRepo: ISubscriptionRepository;
  private paymentRepo: IPaymentRepository;
  private auditLogRepo: IAuditLogRepository;
  private qrCodeService: IQRCodeService;
  private paymentService: IPaymentService;
  private yooKassaService: YooKassaService;

  constructor(
    bot: Telegraf,
    registerUser: RegisterUserUseCase,
    activateTrial: ActivateTrialUseCase,
    getSubscription: GetSubscriptionUseCase,
    purchasePlan: PurchasePlanUseCase,
    renewSubscription: RenewSubscriptionUseCase,
    userRepo: IUserRepository,
    planRepo: IPlanRepository,
    subscriptionRepo: ISubscriptionRepository,
    paymentRepo: IPaymentRepository,
    auditLogRepo: IAuditLogRepository,
    qrCodeService: IQRCodeService,
    paymentService: IPaymentService,
  ) {
    this.bot = bot;
    this.registerUser = registerUser;
    this.activateTrial = activateTrial;
    this.getSubscription = getSubscription;
    this.purchasePlan = purchasePlan;
    this.renewSubscription = renewSubscription;
    this.userRepo = userRepo;
    this.planRepo = planRepo;
    this.subscriptionRepo = subscriptionRepo;
    this.paymentRepo = paymentRepo;
    this.auditLogRepo = auditLogRepo;
    this.qrCodeService = qrCodeService;
    this.paymentService = paymentService;
    this.yooKassaService = new YooKassaService();
  }

  register(): void {
    this.bot.start(this.handleStart);
    this.bot.command('admin', this.handleAdmin);
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
    this.bot.action('admin_menu', this.handleAdmin);
    this.bot.action('admin_users', this.handleAdminUsers);
    this.bot.action('admin_stats', this.handleAdminStats);
    this.bot.action('admin_logs', this.handleAdminLogs);
    this.bot.action('admin_subscriptions', this.handleAdminSubscriptions);

    // Telegram Stars payment handlers
    this.bot.on('shipping_query', this.handleShippingQuery);
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

      // YooKassa (Telegram invoice или fallback на внешнюю ссылку)
      if (getEnv().TELEGRAM_PROVIDER_TOKEN || this.yooKassaService.isConfigured()) {
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
        const payment = await this.paymentService.createPayment(
          user.id,
          planId,
          'stars',
          plan.priceStars,
          'XTR',
        );

        await ctx.replyWithInvoice({
          title: plan.name,
          description: `Подписка на ${plan.durationDays} дней. До ${plan.deviceLimit} устройств.`,
          payload: `plan:stars:${planId}:${payment.paymentId}`,
          currency: 'XTR',
          prices: [{ label: plan.name, amount: plan.priceStars }],
          provider_token: '',
          start_parameter: `vpn_stars_${planId}`,
        });
      } else if (provider === 'yookassa') {
        const env = getEnv();
        if (env.TELEGRAM_PROVIDER_TOKEN) {
          const amountInKopecks = plan.priceRub * 100;
          const payment = await this.paymentService.createPayment(
            user.id,
            planId,
            'yookassa',
            plan.priceRub,
            'RUB',
          );

          await ctx.replyWithInvoice({
            title: plan.name,
            description: `Подписка на ${plan.durationDays} дней. До ${plan.deviceLimit} устройств.`,
            payload: `plan:yookassa:${planId}:${payment.paymentId}`,
            provider_token: env.TELEGRAM_PROVIDER_TOKEN,
            currency: 'RUB',
            prices: [{ label: 'К оплате', amount: amountInKopecks }],
            start_parameter: `vpn_yookassa_${planId}`,
          });
        } else {
          const payment = await this.paymentService.createPayment(
            user.id,
            planId,
            'yookassa',
            plan.priceRub,
            'RUB',
          );

          let paymentUrl = payment.url;
          if (!paymentUrl) {
            const result = await this.yooKassaService.createPayment({
              userId: user.id,
              planId,
              planName: plan.name,
              amount: plan.priceRub,
              currency: 'RUB',
              description: `VPN ${plan.name} - ${plan.durationDays} дней`,
              internalPaymentId: payment.paymentId,
            });

            paymentUrl = result.url;
            if (paymentUrl) {
              await this.paymentRepo.update(payment.paymentId, { externalPaymentId: paymentUrl });
            }
          }

          if (paymentUrl) {
            await ctx.reply(
              `💳 Telegram-платежи временно недоступны, используем резервный способ.\n\n` +
                `Оплатите по ссылке:\n${paymentUrl}\n\n` +
                `После оплаты подписка активируется автоматически.`,
              { reply_markup: backToMainKeyboard() },
            );
          } else {
            await ctx.reply('Не удалось получить ссылку на оплату.', {
              reply_markup: backToMainKeyboard(),
            });
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error processing payment method');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleShippingQuery = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const query = ctx.update && 'shipping_query' in ctx.update ? ctx.update.shipping_query : null;
      if (!query) return;

      await ctx.telegram.answerShippingQuery(
        query.id,
        true,
        [
          {
            id: 'digital_delivery',
            title: 'Цифровая доставка',
            prices: [{ label: 'Доставка', amount: 0 }],
          },
        ],
        undefined,
      );
    } catch (err) {
      logger.error({ err }, 'Error in shipping_query');
      const query = ctx.update && 'shipping_query' in ctx.update ? ctx.update.shipping_query : null;
      if (query) {
        await ctx.telegram.answerShippingQuery(query.id, false, undefined, 'Не удалось рассчитать доставку');
      }
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

      await ctx.editMessageText(text, { reply_markup: backToMainKeyboard(), parse_mode: 'Markdown' });
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
        const result = await this.renewSubscription.execute(subscription.id, env.TRIAL_DURATION_DAYS);
        await ctx.editMessageText(
          `✅ Бесплатная подписка продлена до ${formatDate(result.endDate)}.`,
          { reply_markup: backToMainKeyboard() },
        );
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

  private handlePreCheckout = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const query = ctx.update && 'pre_checkout_query' in ctx.update ? ctx.update.pre_checkout_query : null;
      if (!query) return;

      const payloadParts = query.invoice_payload.split(':');
      if (payloadParts.length !== 4 || payloadParts[0] !== 'plan') {
        await ctx.answerPreCheckoutQuery(false, 'Некорректный payload оплаты.');
        return;
      }

      const provider = payloadParts[1];
      const planId = payloadParts[2];
      const paymentId = payloadParts[3];
      if (!planId || !paymentId || (provider !== 'stars' && provider !== 'yookassa')) {
        await ctx.answerPreCheckoutQuery(false, 'Некорректные данные оплаты.');
        return;
      }

      const [plan, payment, user] = await Promise.all([
        this.planRepo.findById(planId),
        this.paymentRepo.findById(paymentId),
        this.userRepo.findByTelegramId(query.from.id),
      ]);

      if (!plan || !payment || !user) {
        await ctx.answerPreCheckoutQuery(false, 'Платеж не найден или недоступен.');
        return;
      }

      if (
        payment.userId !== user.id ||
        payment.planId !== plan.id ||
        payment.provider !== provider ||
        payment.status !== 'pending'
      ) {
        await ctx.answerPreCheckoutQuery(false, 'Платеж не прошел валидацию.');
        return;
      }

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

      const successfulPayment = payment.successful_payment;
      const payload = successfulPayment.invoice_payload;
      const payloadParts = payload.split(':');
      if (payloadParts.length !== 4 || payloadParts[0] !== 'plan') {
        await ctx.reply('Ошибка: некорректные данные оплаты.', { reply_markup: backToMainKeyboard() });
        return;
      }
      const provider = payloadParts[1];
      const planId = payloadParts[2];
      const paymentId = payloadParts[3];
      if (!planId || !paymentId || (provider !== 'stars' && provider !== 'yookassa')) {
        await ctx.reply('Ошибка: неизвестный провайдер оплаты.', { reply_markup: backToMainKeyboard() });
        return;
      }

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const result = await this.purchasePlan.execute(user.id, planId, provider);
      await this.paymentService.markAsCompleted(
        paymentId,
        successfulPayment.provider_payment_charge_id,
      );

      await ctx.reply(Texts.PAYMENT_SUCCESS);

      const qrCode = await this.qrCodeService.generateBase64(result.subscriptionUrl);
      const qrBase64 = qrCode.split(',')[1] ?? '';
      await ctx.replyWithPhoto(
        { source: Buffer.from(qrBase64, 'base64') },
        { caption: Texts.SUBSCRIPTION_URL.replace('{url}', result.subscriptionUrl) },
      );
      await ctx.reply(Texts.INSTRUCTIONS, { reply_markup: backToMainKeyboard() });

      await this.auditLogRepo.create({
        userId: user.id,
        action: 'telegram_payment_successful',
        entityType: 'payment',
        entityId: paymentId,
        metadata: {
          provider,
          planId,
          telegramChargeId: successfulPayment.telegram_payment_charge_id,
          providerPaymentChargeId: successfulPayment.provider_payment_charge_id,
          totalAmount: successfulPayment.total_amount,
          currency: successfulPayment.currency,
        },
      });
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

  private handleAdminUsers = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    if (!env.ADMIN_TELEGRAM_ID || ctx.from?.id !== env.ADMIN_TELEGRAM_ID) return;

    try {
      const users = await this.userRepo.findAll();
      let text = `👥 Пользователи (${users.length}):\n\n`;
      users.slice(0, 10).forEach((user: any, index: number) => {
        text += `${index + 1}. ${user.firstName} (@${user.username || 'нет'}) - ${formatDate(user.createdAt)}\n`;
      });
      if (users.length > 10) text += `\n... и ещё ${users.length - 10} пользователей`;

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch (err) {
      await ctx.reply('❌ Ошибка загрузки пользователей');
    }
  };

  private handleAdminStats = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    if (!env.ADMIN_TELEGRAM_ID || ctx.from?.id !== env.ADMIN_TELEGRAM_ID) return;

    try {
      const usersCount = await this.userRepo.count();
      const subscriptionsCount = await this.subscriptionRepo.count();
      const paymentsCount = await this.paymentRepo.count();
      const logsCount = await this.auditLogRepo.count();

      const text = `📊 Статистика:\n\n👥 Пользователей: ${usersCount}\n💳 Подписок: ${subscriptionsCount}\n💰 Платежей: ${paymentsCount}\n📋 Логов: ${logsCount}`;

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch (err) {
      await ctx.reply('❌ Ошибка загрузки статистики');
    }
  };

  private handleAdminLogs = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    if (!env.ADMIN_TELEGRAM_ID || ctx.from?.id !== env.ADMIN_TELEGRAM_ID) return;

    try {
      const logs = await this.auditLogRepo.findAll({ limit: 10, order: { createdAt: 'DESC' } });
      let text = `📋 Последние логи (${logs.length}):\n\n`;
      logs.forEach((log: any, index: number) => {
        text += `${index + 1}. ${log.action} - ${log.entityType || ''} (${formatDate(log.createdAt)})\n`;
      });

      await ctx.editMessageText(text, { reply_markup: adminBackKeyboard() });
    } catch (err) {
      await ctx.reply('❌ Ошибка загрузки логов');
    }
  };

  private handleAdminSubscriptions = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    if (!env.ADMIN_TELEGRAM_ID || ctx.from?.id !== env.ADMIN_TELEGRAM_ID) return;

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
    } catch (err) {
      await ctx.reply('❌ Ошибка загрузки подписок');
    }
  };

  private handleAdmin = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    if (!env.ADMIN_TELEGRAM_ID || ctx.from?.id !== env.ADMIN_TELEGRAM_ID) {
      await ctx.reply('❌ Доступ запрещен');
      return;
    }

    await ctx.reply('🔧 Админ-панель', {
      reply_markup: adminKeyboard(),
    });
  };
}