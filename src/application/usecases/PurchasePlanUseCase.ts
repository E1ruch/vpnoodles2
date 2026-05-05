import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { IRemnawaveService } from '../../domain/interfaces/services.js';
import type { IPaymentService } from '../../domain/interfaces/services.js';
import type { IQRCodeService } from '../../domain/interfaces/services.js';
import { getLogger } from '../../shared/logger/index.js';
import { ValidationError, SubscriptionError } from '../../shared/errors/index.js';
import { daysFromNow } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';
import type { PaymentProvider } from '../../shared/types/index.js';

export interface PurchaseResult {
  subscriptionId: string;
  subscriptionUrl: string;
  qrCodeBase64: string;
}

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
  ) {}

  async execute(
    userId: string,
    planId: string,
    provider: PaymentProvider,
  ): Promise<PurchaseResult> {
    const logger = getLogger();

    const user = await this.userRepo.findById(userId);
    if (!user) throw new ValidationError('User not found');

    const plan = await this.planRepo.findById(planId);
    if (!plan) throw new ValidationError('Plan not found');
    if (plan.type === 'trial') throw new ValidationError('Use trial activation for trial plans');

    // Check for existing active subscription
    let existingRemnawaveUserId: string | null = null;
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
        // Если это платный тариф - нельзя купить ещё один
        throw new SubscriptionError('User already has active paid subscription');
      }
    }

    // Determine amount based on provider
    const amount = provider === 'stars' ? plan.priceStars : plan.priceRub;
    const currency = provider === 'stars' ? 'XTR' : 'RUB';

    // Create payment
    const paymentResult = await this.paymentService.createPayment(
      userId,
      planId,
      provider,
      amount,
      currency,
    );

    // Mark payment as completed (for Stars, it's instant)
    if (provider === 'stars') {
      await this.paymentService.markAsCompleted(
        paymentResult.paymentId,
        `stars_${paymentResult.paymentId}`,
      );
    }

    // Create or upgrade user in Remnawave
    const env = getEnv();
    const tag = plan.remnawaveTag ?? 'PAID';
    const activeInternalSquads = env.REMNAWAVE_DEFAULT_SQUAD ? [env.REMNAWAVE_DEFAULT_SQUAD] : [];

    let remnawaveUserId: string;

    if (existingRemnawaveUserId) {
      // Апгрейд существующего пользователя
      await this.remnawaveService.upgradeUser(existingRemnawaveUserId, {
        tag,
        deviceLimit: plan.deviceLimit,
        trafficLimitBytes: 0, // Безлимит для платных
        trafficLimitStrategy: 'NO_RESET',
        expireAt: daysFromNow(plan.durationDays),
      });
      remnawaveUserId = existingRemnawaveUserId;
    } else {
      // Создаём нового пользователя
      remnawaveUserId = await this.remnawaveService.createUser(
        user.telegramId,
        user.username ?? `user_${user.telegramId}`,
        tag,
        activeInternalSquads,
        {
          deviceLimit: plan.deviceLimit,
        },
      );
    }

    const startDate = new Date();
    const endDate = daysFromNow(plan.durationDays);

    const subscription = await this.subscriptionRepo.create({
      userId,
      planId,
      status: 'active',
      startDate,
      endDate,
      deviceLimit: plan.deviceLimit,
      remnawaveUserId,
    });

    // Get subscription URL
    const subscriptionUrl = await this.remnawaveService.getSubscriptionUrl(remnawaveUserId);
    await this.subscriptionRepo.update(subscription.id, { subscriptionUrl });

    // Generate QR code
    const qrCodeBase64 = await this.qrCodeService.generateBase64(subscriptionUrl);

    await this.auditLogRepo.create({
      userId,
      action: 'subscription_purchased',
      entityType: 'subscription',
      entityId: subscription.id,
      metadata: { planId, provider, amount, paymentId: paymentResult.paymentId },
    });

    logger.info({ userId, subscriptionId: subscription.id, planId }, 'Plan purchased');
    return { subscriptionId: subscription.id, subscriptionUrl, qrCodeBase64 };
  }
}
