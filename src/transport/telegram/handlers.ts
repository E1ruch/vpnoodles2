import { Context, Telegraf } from 'telegraf';
import type { RegisterUserUseCase } from '../../application/usecases/RegisterUserUseCase.js';
import type { ActivateTrialUseCase } from '../../application/usecases/ActivateTrialUseCase.js';
import type { GetSubscriptionUseCase } from '../../application/usecases/GetSubscriptionUseCase.js';
import type { PurchasePlanUseCase } from '../../application/usecases/PurchasePlanUseCase.js';
import type { RenewSubscriptionUseCase } from '../../application/usecases/RenewSubscriptionUseCase.js';
import type { GetUserDevicesUseCase } from '../../application/usecases/GetUserDevicesUseCase.js';
import type { DeleteUserDeviceUseCase } from '../../application/usecases/DeleteUserDeviceUseCase.js';
import type { SyncAllSubscriptionsFromRemnawaveUseCase } from '../../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import type { MigrateUsersToRemnawaveUseCase } from '../../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import type { HwidDevice } from '../../shared/types/index.js';
import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type {
  IQRCodeService,
  IPaymentService,
  IRemnawaveService,
} from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';
import { isAppError, NotFoundError } from '../../shared/errors/index.js';
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
  pendingPaymentGateKeyboard,
  payLinkKeyboard,
  profileKeyboard,
  devicesKeyboard,
  deleteDeviceConfirmKeyboard,
} from './keyboards.js';
import { YooKassaService } from '../../infrastructure/payments/YooKassaService.js';
import { runYooKassaFulfillmentTick } from '../../infrastructure/payments/yooKassaFulfillment.js';
import { AdminHandlers } from './admin/AdminHandlers.js';

export class BotHandlers {
  private bot: Telegraf;
  private registerUser: RegisterUserUseCase;
  private activateTrial: ActivateTrialUseCase;
  private getSubscription: GetSubscriptionUseCase;
  private purchasePlan: PurchasePlanUseCase;
  private renewSubscription: RenewSubscriptionUseCase;
  private getUserDevices: GetUserDevicesUseCase;
  private deleteUserDevice: DeleteUserDeviceUseCase;
  private userRepo: IUserRepository;
  private planRepo: IPlanRepository;
  private subscriptionRepo: ISubscriptionRepository;
  private paymentRepo: IPaymentRepository;
  private auditLogRepo: IAuditLogRepository;
  private qrCodeService: IQRCodeService;
  private paymentService: IPaymentService;
  private yooKassaService: YooKassaService;
  private adminHandlers: AdminHandlers;

  constructor(
    bot: Telegraf,
    registerUser: RegisterUserUseCase,
    activateTrial: ActivateTrialUseCase,
    getSubscription: GetSubscriptionUseCase,
    purchasePlan: PurchasePlanUseCase,
    renewSubscription: RenewSubscriptionUseCase,
    getUserDevices: GetUserDevicesUseCase,
    deleteUserDevice: DeleteUserDeviceUseCase,
    userRepo: IUserRepository,
    planRepo: IPlanRepository,
    subscriptionRepo: ISubscriptionRepository,
    paymentRepo: IPaymentRepository,
    auditLogRepo: IAuditLogRepository,
    qrCodeService: IQRCodeService,
    paymentService: IPaymentService,
    remnawaveService: IRemnawaveService,
    syncAllFromRemnawave: SyncAllSubscriptionsFromRemnawaveUseCase,
    migrateUsersToRemnawave: MigrateUsersToRemnawaveUseCase,
  ) {
    this.bot = bot;
    this.registerUser = registerUser;
    this.activateTrial = activateTrial;
    this.getSubscription = getSubscription;
    this.purchasePlan = purchasePlan;
    this.renewSubscription = renewSubscription;
    this.getUserDevices = getUserDevices;
    this.deleteUserDevice = deleteUserDevice;
    this.userRepo = userRepo;
    this.planRepo = planRepo;
    this.subscriptionRepo = subscriptionRepo;
    this.paymentRepo = paymentRepo;
    this.auditLogRepo = auditLogRepo;
    this.qrCodeService = qrCodeService;
    this.paymentService = paymentService;
    this.yooKassaService = new YooKassaService();
    this.adminHandlers = new AdminHandlers(
      bot,
      this.userRepo,
      this.planRepo,
      this.subscriptionRepo,
      this.paymentRepo,
      this.auditLogRepo,
      remnawaveService,
      renewSubscription,
      syncAllFromRemnawave,
      migrateUsersToRemnawave,
    );
  }

  register(): void {
    this.bot.start(this.handleStart);
    this.bot.command('check_payment', this.handleCheckPayment);
    this.bot.action('back_main', this.handleBackMain);
    this.bot.action('my_vpn', this.handleMyVpn);
    this.bot.action('plans', this.handlePlans);
    this.bot.action('plan_trial', this.handlePlanTrial);
    this.bot.action('plan_paid', this.handlePlanPaid);
    this.bot.action('activate_trial', this.handleActivateTrial);
    this.bot.action('instructions', this.handleInstructions);
    this.bot.action('profile', this.handleProfile);
    this.bot.action('devices', this.handleDevices);
    this.bot.action(/^del_dev_(\d+)$/, this.handleDeleteDevicePrompt);
    this.bot.action(/^confirm_del_dev_(\d+)$/, this.handleDeleteDevice);
    this.bot.action('support', this.handleSupport);
    this.bot.action(/^buy_(.+)$/, this.handleBuyPlan);
    this.bot.action(/^renew_(.+)$/, this.handleRenew);
    this.bot.action(/^pay_(stars|yookassa)_(.+)$/, this.handlePaymentMethod);
    this.bot.action(/^cancel_payment_(.+)$/, this.handleCancelPayment);
    this.adminHandlers.register(this.bot);

    // Telegram payment handlers (Stars / ЮKassa через provider_token)
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

  private handleCheckPayment = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      if (!this.yooKassaService.isConfigured()) {
        await ctx.reply(Texts.CHECK_PAYMENT_YOOKASSA_DISABLED, { reply_markup: backToMainKeyboard() });
        return;
      }

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const { fulfilled } = await runYooKassaFulfillmentTick(
        {
          paymentRepo: this.paymentRepo,
          purchasePlanUseCase: this.purchasePlan,
          userRepo: this.userRepo,
          qrCodeService: this.qrCodeService,
          bot: this.bot,
        },
        this.yooKassaService,
        { filterUserId: user.id },
      );

      if (fulfilled > 0) {
        return;
      }

      const pending = await this.paymentRepo.findPendingByUserId(user.id);
      if (pending?.provider === 'yookassa') {
        await ctx.reply(Texts.CHECK_PAYMENT_STILL_PENDING, {
          reply_markup: pendingPaymentGateKeyboard(`pay_yookassa_${pending.planId}`, pending.id),
        });
      } else if (pending?.provider === 'stars') {
        await ctx.reply(Texts.CHECK_PAYMENT_STARS_PENDING, {
          reply_markup: pendingPaymentGateKeyboard(`pay_stars_${pending.planId}`, pending.id),
        });
      } else {
        await ctx.reply(Texts.CHECK_PAYMENT_NO_PENDING, { reply_markup: backToMainKeyboard() });
      }
    } catch (err) {
      logger.error({ err }, 'Error in /check_payment handler');
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

      const pendingPayment = await this.paymentRepo.findPendingByUserId(user.id);
      if (pendingPayment) {
        const ttlMinutes = getEnv().PAYMENT_PENDING_TTL_MINUTES;
        const expiresAtMs = pendingPayment.createdAt.getTime() + ttlMinutes * 60 * 1000;
        const isExpired = Date.now() > expiresAtMs;

        if (isExpired) {
          await this.paymentRepo.update(pendingPayment.id, { status: 'failed' });
        } else if (pendingPayment.planId !== planId || pendingPayment.provider !== provider) {
          const pendingPlan = await this.planRepo.findById(pendingPayment.planId);
          const minutesLeft = Math.max(1, Math.ceil((expiresAtMs - Date.now()) / 60000));
          const providerLabel =
            pendingPayment.provider === 'stars'
              ? 'Telegram Stars'
              : pendingPayment.provider === 'yookassa'
                ? 'Картой'
                : pendingPayment.provider;
          const amountStr =
            pendingPayment.currency === 'XTR'
              ? `${pendingPayment.amount} ⭐`
              : formatCurrency(pendingPayment.amount);
          const continuePayCallbackData =
            pendingPayment.provider === 'stars' || pendingPayment.provider === 'yookassa'
              ? `pay_${pendingPayment.provider}_${pendingPayment.planId}`
              : null;

          await ctx.editMessageText(
            Texts.PENDING_PAYMENT_GATE.replace('{planName}', pendingPlan?.name ?? 'Тариф')
              .replace('{amountStr}', amountStr)
              .replace('{providerLabel}', providerLabel)
              .replace('{minutesLeft}', String(minutesLeft)),
            {
              reply_markup: pendingPaymentGateKeyboard(
                continuePayCallbackData,
                pendingPayment.id,
              ),
            },
          );
          return;
        }
      }

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
          if (paymentUrl && !paymentUrl.startsWith('http')) {
            paymentUrl =
              (await this.yooKassaService.getConfirmationUrl(paymentUrl)) ?? paymentUrl;
          }
          if (!paymentUrl || !paymentUrl.startsWith('http')) {
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
            if (result.externalId) {
              await this.paymentRepo.update(payment.paymentId, {
                externalPaymentId: result.externalId,
              });
            }
          }

          if (paymentUrl) {
            await ctx.reply(
              `💳 Telegram-платежи временно недоступны, используем резервный способ.\n\n` +
                `Оплатите по ссылке:\n${paymentUrl}\n\n` +
                `После оплаты доступ активируется в течение минуты (проверка в ЮKassa). Можно отправить /check_payment.`,
              { reply_markup: payLinkKeyboard(payment.paymentId) },
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

  private handleCancelPayment = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      const paymentId = cbData.data.replace('cancel_payment_', '');
      const [user, payment] = await Promise.all([
        this.userRepo.findByTelegramId(telegramUser.id),
        this.paymentRepo.findById(paymentId),
      ]);

      if (!user || !payment || payment.userId !== user.id) {
        await ctx.reply(Texts.PAYMENT_CANCEL_NOT_FOUND, { reply_markup: backToMainKeyboard() });
        return;
      }

      if (payment.status === 'completed') {
        await ctx.reply(Texts.PAYMENT_CANCEL_COMPLETED, { reply_markup: backToMainKeyboard() });
        return;
      }

      if (payment.status !== 'pending') {
        await ctx.reply(Texts.PAYMENT_CANCEL_NOT_FOUND, { reply_markup: backToMainKeyboard() });
        return;
      }

      if (payment.provider === 'yookassa' && payment.externalPaymentId && this.yooKassaService.isConfigured()) {
        try {
          await this.yooKassaService.cancelPayment(payment.externalPaymentId);
        } catch (cancelErr) {
          logger.warn(
            { cancelErr, paymentId: payment.id, externalPaymentId: payment.externalPaymentId },
            'Could not cancel YooKassa payment remotely; canceling local pending payment',
          );
        }
      }

      await this.paymentService.cancelPayment(payment.id);
      await ctx.reply(Texts.PAYMENT_CANCELED, { reply_markup: planSelectionKeyboard() });
    } catch (err) {
      logger.error({ err }, 'Error canceling payment');
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
      const devicesLine = sub
        ? Texts.PROFILE_DEVICES_LINE.replace('{usedDevices}', String(sub.usedDevices)).replace(
            '{deviceLimit}',
            String(sub.deviceLimit),
          )
        : '';

      const text = Texts.PROFILE.replace('{telegramId}', String(user.telegramId))
        .replace('{firstName}', user.firstName ?? 'Не указано')
        .replace('{status}', status)
        .replace('{regDate}', formatDate(user.createdAt))
        .replace('{devicesLine}', devicesLine);

      await ctx.editMessageText(text, {
        reply_markup: profileKeyboard(),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDevices = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.editMessageText(Texts.DEVICES_NO_SUBSCRIPTION, {
          reply_markup: profileKeyboard(),
          parse_mode: 'Markdown',
        });
        return;
      }

      const { total, devices, deviceLimit } = devicesInfo;

      if (total === 0 || devices.length === 0) {
        const text = Texts.DEVICES_EMPTY.replace('{deviceLimit}', String(deviceLimit));
        await ctx.editMessageText(text, {
          reply_markup: devicesKeyboard(0, false),
          parse_mode: 'Markdown',
        });
        return;
      }

      const devicesList = devices.map((device, index) => this.formatDeviceListItem(device, index)).join('\n\n');
      const text = Texts.DEVICES_LIST.replace('{total}', String(total))
        .replace('{deviceLimit}', String(deviceLimit))
        .replace('{devicesList}', devicesList);

      await ctx.editMessageText(text, {
        reply_markup: devicesKeyboard(devices.length, true),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDeleteDevicePrompt = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      const match = cbData.data.match(/^del_dev_(\d+)$/);
      if (!match?.[1]) return;

      const deviceIndex = Number.parseInt(match[1], 10);
      if (!Number.isFinite(deviceIndex) || deviceIndex < 0) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.reply(Texts.DEVICES_NO_SUBSCRIPTION, { reply_markup: profileKeyboard() });
        return;
      }

      const device = devicesInfo.devices[deviceIndex];
      if (!device) {
        await ctx.reply(Texts.DEVICE_DELETE_NOT_FOUND, { reply_markup: devicesKeyboard(0, false) });
        return;
      }

      const text = Texts.DEVICE_DELETE_CONFIRM.replace(
        '{deviceInfo}',
        this.formatDeviceDetail(device, deviceIndex),
      );

      await ctx.editMessageText(text, {
        reply_markup: deleteDeviceConfirmKeyboard(deviceIndex),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDeleteDevice = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      const match = cbData.data.match(/^confirm_del_dev_(\d+)$/);
      if (!match?.[1]) return;

      const deviceIndex = Number.parseInt(match[1], 10);
      if (!Number.isFinite(deviceIndex) || deviceIndex < 0) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.reply(Texts.DEVICES_NO_SUBSCRIPTION, { reply_markup: profileKeyboard() });
        return;
      }

      const device = devicesInfo.devices[deviceIndex];
      if (!device) {
        await ctx.editMessageText(Texts.DEVICE_DELETE_NOT_FOUND, {
          reply_markup: devicesKeyboard(0, false),
          parse_mode: 'Markdown',
        });
        return;
      }

      await this.deleteUserDevice.execute(user.id, device.hwid);

      const refreshed = await this.getUserDevices.execute(user.id);
      const total = refreshed?.total ?? 0;
      const deviceLimit = refreshed?.deviceLimit ?? devicesInfo.deviceLimit;

      if (total === 0 || !refreshed?.devices.length) {
        const text = Texts.DEVICE_DELETED.replace('{total}', '0').replace(
          '{deviceLimit}',
          String(deviceLimit),
        );
        await ctx.editMessageText(`${text}\n\n${Texts.DEVICES_EMPTY.replace('{deviceLimit}', String(deviceLimit))}`, {
          reply_markup: devicesKeyboard(0, false),
          parse_mode: 'Markdown',
        });
        return;
      }

      const devicesList = refreshed.devices
        .map((d, index) => this.formatDeviceListItem(d, index))
        .join('\n\n');
      const text =
        Texts.DEVICE_DELETED.replace('{total}', String(total)).replace(
          '{deviceLimit}',
          String(deviceLimit),
        ) +
        '\n\n' +
        Texts.DEVICES_LIST.replace('{total}', String(total))
          .replace('{deviceLimit}', String(deviceLimit))
          .replace('{devicesList}', devicesList);

      await ctx.editMessageText(text, {
        reply_markup: devicesKeyboard(refreshed.devices.length, true),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, 'Error deleting device');
      if (err instanceof NotFoundError) {
        await ctx.reply(Texts.DEVICE_DELETE_NOT_FOUND, { reply_markup: devicesKeyboard(0, false) });
        return;
      }
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private formatDeviceListItem(device: HwidDevice, index: number): string {
    const title = this.formatDeviceTitle(device, index);
    const details = this.formatDeviceMeta(device);
    return `${title}\n${details}`;
  }

  private formatDeviceDetail(device: HwidDevice, index: number): string {
    const title = this.formatDeviceTitle(device, index);
    const details = this.formatDeviceMeta(device);
    const hwid = this.formatHwidShort(device.hwid);
    return `${title}\n${details}\n🔑 ID: \`${hwid}\``;
  }

  private formatDeviceTitle(device: HwidDevice, index: number): string {
    const model = device.deviceModel?.trim();
    const platform = device.platform?.trim();
    if (model) return `**${index + 1}. ${model}**`;
    if (platform) return `**${index + 1}. ${platform}**`;
    return `**${index + 1}. Устройство**`;
  }

  private formatDeviceMeta(device: HwidDevice): string {
    const parts: string[] = [];
    if (device.platform) parts.push(`🖥 Платформа: ${device.platform}`);
    if (device.osVersion) parts.push(`📦 ОС: ${device.osVersion}`);
    if (device.createdAt) parts.push(`📅 Подключено: ${formatDate(new Date(device.createdAt))}`);
    if (parts.length === 0) parts.push('ℹ️ Дополнительные данные недоступны');
    return parts.join('\n');
  }

  private formatHwidShort(hwid: string): string {
    if (hwid.length <= 16) return hwid;
    return `${hwid.slice(0, 8)}…${hwid.slice(-4)}`;
  }

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

  private handlePreCheckout = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    const updateId = ctx.update?.update_id;
    let preCheckoutAnswered = false;

    const answerPreCheckout = async (ok: boolean, errorMessage?: string): Promise<void> => {
      const query = ctx.update && 'pre_checkout_query' in ctx.update ? ctx.update.pre_checkout_query : null;
      const queryId = query?.id ?? 'unknown';
      logger.info(
        { updateId, queryId, ok, errorMessage: ok ? undefined : errorMessage },
        'answerPreCheckoutQuery → calling Telegram API',
      );
      try {
        await ctx.answerPreCheckoutQuery(ok, errorMessage);
        preCheckoutAnswered = true;
        logger.info({ updateId, queryId, ok }, 'answerPreCheckoutQuery ← Telegram API OK');
      } catch (err) {
        logger.error({ updateId, queryId, ok, err }, 'answerPreCheckoutQuery ← Telegram API FAILED');
        throw err;
      }
    };

    try {
      const query = ctx.update && 'pre_checkout_query' in ctx.update ? ctx.update.pre_checkout_query : null;
      if (!query) {
        logger.warn({ updateId }, 'Telegram update without pre_checkout_query (cannot answerPreCheckoutQuery)');
        return;
      }

      logger.info(
        {
          updateId,
          queryId: query.id,
          fromId: query.from.id,
          currency: query.currency,
          totalAmount: query.total_amount,
          invoicePayload: query.invoice_payload,
        },
        'PreCheckoutQuery ← received from Telegram',
      );

      const payloadParts = query.invoice_payload.split(':');
      if (payloadParts.length !== 4 || payloadParts[0] !== 'plan') {
        logger.warn({ updateId, queryId: query.id }, 'PreCheckout rejected: invalid_payload');
        await answerPreCheckout(false, 'Некорректный payload оплаты.');
        return;
      }

      const provider = payloadParts[1];
      const planId = payloadParts[2];
      const paymentId = payloadParts[3];
      if (!planId || !paymentId || (provider !== 'stars' && provider !== 'yookassa')) {
        logger.warn(
          { updateId, queryId: query.id, planId, paymentId, provider },
          'PreCheckout rejected: bad_provider_or_ids',
        );
        await answerPreCheckout(false, 'Некорректные данные оплаты.');
        return;
      }

      const [plan, payment, user] = await Promise.all([
        this.planRepo.findById(planId),
        this.paymentRepo.findById(paymentId),
        this.userRepo.findByTelegramId(query.from.id),
      ]);

      if (!plan || !payment || !user) {
        logger.warn({ updateId, queryId: query.id, planId, paymentId }, 'PreCheckout rejected: not_found');
        await answerPreCheckout(false, 'Платеж не найден или недоступен.');
        return;
      }

      const expectedCurrency = provider === 'stars' ? 'XTR' : 'RUB';
      const expectedAmount =
        provider === 'stars' ? plan.priceStars : Math.round(plan.priceRub * 100);
      if (query.currency !== expectedCurrency || query.total_amount !== expectedAmount) {
        logger.warn(
          {
            updateId,
            queryId: query.id,
            got: { currency: query.currency, totalAmount: query.total_amount },
            expected: { currency: expectedCurrency, totalAmount: expectedAmount },
          },
          'PreCheckout rejected: amount_currency_mismatch',
        );
        await answerPreCheckout(false, 'Неверная сумма или валюта платежа.');
        return;
      }

      if (
        payment.userId !== user.id ||
        payment.planId !== plan.id ||
        payment.provider !== provider ||
        payment.status !== 'pending'
      ) {
        logger.warn(
          {
            updateId,
            queryId: query.id,
            paymentUserId: payment.userId,
            userId: user.id,
            paymentPlanId: payment.planId,
            planId: plan.id,
            paymentProvider: payment.provider,
            provider,
            paymentStatus: payment.status,
          },
          'PreCheckout rejected: validation_failed',
        );
        await answerPreCheckout(false, 'Платеж не прошел валидацию.');
        return;
      }

      logger.info(
        { updateId, queryId: query.id, paymentId, planId, provider },
        'PreCheckoutQuery validation OK → approving',
      );
      await answerPreCheckout(true);
    } catch (err) {
      logger.error({ updateId, err }, 'Error in pre_checkout handler');
      if (!preCheckoutAnswered) {
        try {
          await answerPreCheckout(false, 'Ошибка обработки платежа');
        } catch (answerErr) {
          logger.error({ updateId, err: answerErr }, 'Could not answerPreCheckoutQuery after handler error');
        }
      }
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

      const result = await this.purchasePlan.execute(user.id, planId, provider, {
        existingPaymentId: paymentId,
        externalChargeId:
          successfulPayment.provider_payment_charge_id ??
          successfulPayment.telegram_payment_charge_id ??
          `${provider}_${paymentId}`,
      });

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

}
