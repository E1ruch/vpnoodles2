import { Context, Telegraf } from 'telegraf';
import type { PurchasePlanUseCase } from '../../../application/usecases/PurchasePlanUseCase.js';
import type {
  IUserRepository,
  IPlanRepository,
  IPaymentRepository,
  IAuditLogRepository,
} from '../../../domain/interfaces/repositories.js';
import type { IPaymentService } from '../../../domain/interfaces/services.js';
import { getLogger } from '../../../shared/logger/index.js';
import { isAppError, PaymentLockedError } from '../../../shared/errors/index.js';
import { formatCurrency } from '../../../shared/utils/index.js';
import { getEnv } from '../../../shared/config/env.js';
import { Texts } from '../texts.js';
import {
  backToMainKeyboard,
  planSelectionKeyboard,
  pendingPaymentGateKeyboard,
  payLinkKeyboard,
} from '../keyboards.js';
import { YooKassaService } from '../../../infrastructure/payments/YooKassaService.js';
import { runYooKassaFulfillmentTick } from '../../../infrastructure/payments/yooKassaFulfillment.js';
import { sendSubscriptionDelivered } from './subscriptionDelivery.js';

/**
 * Весь платёжный флоу: выбор способа оплаты, инвойсы Stars/ЮKassa, отмена,
 * ручная проверка платежа (/check_payment), pre_checkout_query и successful_payment.
 * Вынесено из BotHandlers при разбиении handlers.ts (был 1147 строк) на модули
 * по доменным группам — код и тексты не менялись, только перенос.
 */
export class PaymentHandlers {
  private yooKassaService: YooKassaService;

  constructor(
    private bot: Telegraf,
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
    private paymentService: IPaymentService,
    private purchasePlan: PurchasePlanUseCase,
  ) {
    this.yooKassaService = new YooKassaService();
  }

  register(bot: Telegraf): void {
    bot.command('check_payment', this.handleCheckPayment);
    bot.action(/^buy_(.+)$/, this.handleBuyPlan);
    bot.action(/^pay_(stars|yookassa)_(.+)$/, this.handlePaymentMethod);
    bot.action(/^cancel_payment_(.+)$/, this.handleCancelPayment);
    bot.on('pre_checkout_query', this.handlePreCheckout);
    bot.on('successful_payment', this.handleSuccessfulPayment);
  }

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

      await sendSubscriptionDelivered(ctx.telegram, telegramUser.id, result.subscriptionId, result.subscriptionUrl);

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
      if (err instanceof PaymentLockedError) {
        // Крайне маловероятный путь для Stars (successful_payment — единственный
        // источник фулфилмента), но на случай ретрая апдейта от Telegram — платёж
        // уже обрабатывается, ничего страшного, не пугаем пользователя ошибкой.
        logger.info({ err }, 'Successful payment: fulfillment locked elsewhere, skip');
        await ctx.reply(Texts.PAYMENT_PENDING, { reply_markup: backToMainKeyboard() });
        return;
      }
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
