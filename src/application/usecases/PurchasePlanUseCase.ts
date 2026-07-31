import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { Payment } from '../../domain/entities/Payment.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { IPaymentService } from '../../domain/interfaces/services.js';
import type { IQRCodeService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';
import { ValidationError, PaymentLockedError } from '../../shared/errors/index.js';
import { daysFromNow } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';
import type { PaymentProvider } from '../../shared/types/index.js';

export interface PurchaseResult {
  subscriptionId: string;
  subscriptionUrl: string;
  qrCodeBase64: string;
}

import type { SyncSubscriptionDevicesUseCase } from './SyncSubscriptionDevicesUseCase.js';
import type { ReferralRewardService } from './referral/ReferralRewardService.js';
import type { ClaimPendingReferralRewardsUseCase } from './referral/ClaimPendingReferralRewardsUseCase.js';

export class PurchasePlanUseCase {
  constructor(
    private userRepo: IUserRepository,
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
    private paymentRepo: IPaymentRepository,
    private auditLogRepo: IAuditLogRepository,
    private remnawaveService: IRemnawaveService,
    private paymentService: IPaymentService,
    private qrCodeService: IQRCodeService,
    private syncSubscriptionDevices: SyncSubscriptionDevicesUseCase,
    private referralRewardService: ReferralRewardService,
    private claimPendingReferralRewards: ClaimPendingReferralRewardsUseCase,
  ) {}

  /**
   * Публичная точка входа. Если это фулфилмент уже созданного платежа
   * (options.existingPaymentId задан — так вызывают webhook, polling-тик YooKassa
   * и обработчик successful_payment для Stars), сначала берём распределённый лок
   * на этот paymentId. Без лока YooKassa webhook и polling-тик (или два перекрывшихся
   * тика) могут одновременно дойти до продления подписки в Remnawave — а extendUser()
   * не идемпотентен, поэтому без лока пользователь может получить задвоенный срок.
   * Если лок не достался — значит платёж уже обрабатывается другим вызовом прямо
   * сейчас, кидаем PaymentLockedError и вызывающий код должен тихо это пропустить.
   */
  async execute(
    userId: string,
    planId: string,
    provider: PaymentProvider,
    options?: { existingPaymentId?: string; externalChargeId?: string },
  ): Promise<PurchaseResult> {
    const fulfillmentPaymentId = options?.existingPaymentId;
    if (!fulfillmentPaymentId) {
      // Нет привязанного платежа — редкий путь (нет реальных вызовов в кодовой базе
      // на момент фикса), лочить нечего, выполняем как есть.
      return this.executeLocked(userId, planId, provider, options);
    }

    const lockAcquired = await this.paymentService.acquireFulfillmentLock(fulfillmentPaymentId);
    if (!lockAcquired) {
      throw new PaymentLockedError(fulfillmentPaymentId);
    }

    try {
      return await this.executeLocked(userId, planId, provider, options);
    } finally {
      await this.paymentService.releaseFulfillmentLock(fulfillmentPaymentId);
    }
  }

  private async executeLocked(
    userId: string,
    planId: string,
    provider: PaymentProvider,
    options?: { existingPaymentId?: string; externalChargeId?: string },
  ): Promise<PurchaseResult> {
    const logger = getLogger();

    const user = await this.userRepo.findById(userId);
    if (!user) throw new ValidationError('User not found');

    const plan = await this.planRepo.findById(planId);
    if (!plan) throw new ValidationError('Plan not found');
    if (plan.type === 'trial') throw new ValidationError('Use trial activation for trial plans');

    // Check for existing active subscription
    let existingRemnawaveUserId: string | null = null;
    let renewalSubscriptionId: string | null = null;
    const existingSub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (existingSub) {
      // Если есть активная подписка - проверяем тип
      const existingPlan = await this.planRepo.findById(existingSub.planId);
      if (existingPlan && existingPlan.type === 'trial') {
        // Если это бесплатный тариф - запоминаем remnawaveUserId для апгрейда
        logger.info(
          { userId, existingSubId: existingSub.id },
          'Upgrading trial subscription to paid',
        );
        existingRemnawaveUserId = existingSub.remnawaveUserId;
        // Деактивируем старую подписку в БД
        await this.subscriptionRepo.update(existingSub.id, { status: 'expired' });
      } else {
        // Платная подписка — продлеваем её, остаток дней переносится
        const remainingDays = Math.ceil(
          (existingSub.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );
        logger.info(
          { userId, existingSubId: existingSub.id, remainingDays },
          'Renewing active paid subscription',
        );
        existingRemnawaveUserId = existingSub.remnawaveUserId;
        renewalSubscriptionId = existingSub.id;
      }
    }

    if (!existingRemnawaveUserId) {
      const allSubscriptions = await this.subscriptionRepo.findByUserId(userId);
      const previousWithRemnawave = allSubscriptions
        .filter((sub) => sub.remnawaveUserId)
        .sort((a, b) => b.endDate.getTime() - a.endDate.getTime())[0];

      if (previousWithRemnawave?.remnawaveUserId) {
        logger.info(
          { userId, previousSubId: previousWithRemnawave.id },
          'Reusing Remnawave user from expired subscription for renewal',
        );
        existingRemnawaveUserId = previousWithRemnawave.remnawaveUserId;
      }
    }

    // Determine amount based on provider
    const amount = provider === 'stars' ? plan.priceStars : plan.priceRub;
    const currency = provider === 'stars' ? 'XTR' : 'RUB';

    let fulfillmentPaymentId: string | undefined = options?.existingPaymentId;
    let existingPaymentRecord: Payment | null = null;

    if (fulfillmentPaymentId) {
      existingPaymentRecord = await this.paymentRepo.findById(fulfillmentPaymentId);
      if (!existingPaymentRecord) {
        throw new ValidationError('Payment not found');
      }
      if (
        existingPaymentRecord.userId !== userId ||
        existingPaymentRecord.planId !== planId ||
        existingPaymentRecord.provider !== provider
      ) {
        throw new ValidationError('Payment does not match purchase');
      }
      if (existingPaymentRecord.status === 'completed') {
        logger.info({ paymentId: fulfillmentPaymentId }, 'Payment already fulfilled');
        return await this.buildPurchaseResultFromActiveSubscription(userId, planId);
      }
      if (existingPaymentRecord.status !== 'pending') {
        throw new ValidationError('Payment is no longer active');
      }
    }

    let paymentResult: { paymentId: string };

    if (fulfillmentPaymentId && existingPaymentRecord) {
      paymentResult = { paymentId: fulfillmentPaymentId };
    } else {
      paymentResult = await this.paymentService.createPayment(
        userId,
        planId,
        provider,
        amount,
        currency,
      );
    }

    // Mark payment as completed (for Stars only when checkout создал новый платёж здесь)
    if (provider === 'stars' && !fulfillmentPaymentId) {
      await this.paymentService.markAsCompleted(
        paymentResult.paymentId,
        `stars_${paymentResult.paymentId}`,
      );
    }

    // Create or upgrade user in Remnawave
    const env = getEnv();
    const tag = plan.remnawaveTag ?? 'PAID';
    const activeInternalSquads = env.REMNAWAVE_DEFAULT_SQUAD ? [env.REMNAWAVE_DEFAULT_SQUAD] : [];

    const expireAt = daysFromNow(plan.durationDays);
    const paidRemnawaveOptions = {
      tag,
      deviceLimit: plan.deviceLimit,
      trafficLimitBytes: 0,
      trafficLimitStrategy: 'NO_RESET' as const,
      expireAt,
    };

    let remnawaveUserId: string;

    if (existingRemnawaveUserId) {
      if (renewalSubscriptionId) {
        // Продление платной подписки: extendUser переносит оставшиеся дни
        await this.remnawaveService.extendUser(existingRemnawaveUserId, plan.durationDays);
        await this.remnawaveService.updateUserTag(existingRemnawaveUserId, tag);
        await this.remnawaveService.updateDeviceLimit(existingRemnawaveUserId, plan.deviceLimit);
      } else {
        await this.remnawaveService.upgradeUser(existingRemnawaveUserId, paidRemnawaveOptions);
      }
      remnawaveUserId = existingRemnawaveUserId;
    } else {
      remnawaveUserId = await this.remnawaveService.createUser(
        user.telegramId,
        user.username ?? `user_${user.telegramId}`,
        tag,
        activeInternalSquads,
        paidRemnawaveOptions,
      );
      // createUser может вернуть уже существующего пользователя в Remnawave без обновления срока
      await this.remnawaveService.upgradeUser(remnawaveUserId, paidRemnawaveOptions);
    }

    let subscriptionId: string;
    let subscriptionUrl: string;

    if (renewalSubscriptionId) {
      // Продление: обновляем существующую подписку, синхронизируем срок из Remnawave
      const actualExpiry = await this.remnawaveService.getUserExpireAt(remnawaveUserId);
      const endDate = actualExpiry ?? expireAt;

      await this.subscriptionRepo.update(renewalSubscriptionId, {
        status: 'active',
        planId,
        deviceLimit: plan.deviceLimit,
        endDate,
        remnawaveUserId,
      });

      subscriptionId = renewalSubscriptionId;
    } else {
      const startDate = new Date();
      const endDate = expireAt;

      const subscription = await this.subscriptionRepo.create({
        userId,
        planId,
        status: 'active',
        startDate,
        endDate,
        deviceLimit: plan.deviceLimit,
        remnawaveUserId,
      });

      subscriptionId = subscription.id;
    }

    // Get subscription URL
    subscriptionUrl = await this.remnawaveService.getSubscriptionUrl(remnawaveUserId);
    await this.subscriptionRepo.update(subscriptionId, { subscriptionUrl });

    // Generate QR code
    const qrCodeBase64 = await this.qrCodeService.generateBase64(subscriptionUrl);

    await this.auditLogRepo.create({
      userId,
      action: renewalSubscriptionId ? 'subscription_renewed' : 'subscription_purchased',
      entityType: 'subscription',
      entityId: subscriptionId,
      metadata: { planId, provider, amount, paymentId: paymentResult.paymentId },
    });

    if (fulfillmentPaymentId && existingPaymentRecord) {
      const externalId =
        options?.externalChargeId ??
        existingPaymentRecord.externalPaymentId ??
        `${provider}_${paymentResult.paymentId}`;
      await this.paymentService.markAsCompleted(fulfillmentPaymentId, externalId);
    }

    await this.syncSubscriptionDevices.execute(subscriptionId);

    // Реферальная программа (§5.4), полностью best-effort — сбой здесь не должен уронить
    // уже успешно проведённую покупку/продление.
    try {
      // "Это первая оплата" — дешевле и явнее, чем протаскивать булев флаг через все три
      // пути фулфилмента (Stars/webhook/polling), см. §5.4.
      const isFirstPayment = (await this.paymentRepo.countCompletedByUserId(userId)) === 1;
      if (isFirstPayment && user.referredByUserId) {
        await this.referralRewardService.processConversionRewards(
          user,
          paymentResult.paymentId,
          plan.durationDays,
        );
      }
      // Сам покупатель мог раньше приглашать других — заберём его собственный банк наград.
      await this.claimPendingReferralRewards.execute(userId, subscriptionId);
    } catch (err) {
      logger.error({ err, userId, subscriptionId }, 'Referral reward processing failed');
    }

    logger.info({ userId, subscriptionId, planId }, 'Plan purchased');
    return { subscriptionId, subscriptionUrl, qrCodeBase64 };
  }

  private async buildPurchaseResultFromActiveSubscription(
    userId: string,
    planId: string,
  ): Promise<PurchaseResult> {
    const sub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (!sub || sub.planId !== planId || !sub.subscriptionUrl) {
      throw new ValidationError('Active subscription not found');
    }
    const qrCodeBase64 = await this.qrCodeService.generateBase64(sub.subscriptionUrl);
    return {
      subscriptionId: sub.id,
      subscriptionUrl: sub.subscriptionUrl,
      qrCodeBase64,
    };
  }
}
