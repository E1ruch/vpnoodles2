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
    const existingSub = await this.subscriptionRepo.findActiveByUserId(userId);
    if (existingSub) {
      throw new SubscriptionError('User already has active subscription');
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

    // Create user in Remnawave with tag and squad
    const env = getEnv();
    const tag = plan.remnawaveTag ?? 'PAID';
    const activeInternalSquads = env.REMNAWAVE_DEFAULT_SQUAD ? [env.REMNAWAVE_DEFAULT_SQUAD] : [];

    const remnawaveUserId = await this.remnawaveService.createUser(
      user.telegramId,
      user.username ?? `user_${user.telegramId}`,
      tag,
      activeInternalSquads,
    );

    // Set device limit
    await this.remnawaveService.updateDeviceLimit(remnawaveUserId, plan.deviceLimit);

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
