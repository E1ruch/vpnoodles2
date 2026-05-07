import { getLogger } from '../../shared/logger/index.js';
import { PaymentError } from '../../shared/errors/index.js';
import { generateId } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';
import type { IPaymentService } from '../../domain/interfaces/services.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { PaymentResult, PaymentProvider, PaymentStatus } from '../../shared/types/index.js';
import type { Payment } from '../../domain/entities/Payment.js';
import type { ICacheService } from '../../domain/interfaces/services.js';

const PAYMENT_LOCK_TTL = 300; // 5 minutes

export class PaymentOrchestrator implements IPaymentService {
  private paymentRepo: IPaymentRepository;
  private cache: ICacheService;

  constructor(paymentRepo: IPaymentRepository, cache: ICacheService) {
    this.paymentRepo = paymentRepo;
    this.cache = cache;
  }

  async createPayment(
    userId: string,
    planId: string,
    provider: PaymentProvider,
    amount: number,
    currency: string,
  ): Promise<PaymentResult> {
    const logger = getLogger();
    const env = getEnv();
    const ttlMinutes = env.PAYMENT_PENDING_TTL_MINUTES;

    // Idempotency: check for existing pending payment
    const existingPayment = await this.paymentRepo.findPendingByUserId(userId);
    if (existingPayment) {
      const createdAtMs = existingPayment.createdAt.getTime();
      const expiresAtMs = createdAtMs + ttlMinutes * 60 * 1000;
      const isExpired = Date.now() > expiresAtMs;

      if (isExpired) {
        await this.paymentRepo.update(existingPayment.id, { status: 'failed' });
      } else if (existingPayment.planId === planId && existingPayment.provider === provider) {
        logger.info(
          { userId, paymentId: existingPayment.id, provider, planId },
          'Reusing active pending payment',
        );
        return {
          paymentId: existingPayment.id,
          provider: existingPayment.provider,
          status: existingPayment.status,
          url: existingPayment.externalPaymentId ?? undefined,
        };
      } else {
        throw new PaymentError('У вас уже есть активный платеж. Завершите его или подождите 10 минут.');
      }
    }

    // Distributed lock to prevent double activation
    const lockKey = `payment_lock:${userId}:${planId}`;
    const existingLock = await this.cache.exists(lockKey);
    if (existingLock) {
      throw new PaymentError('Payment already being processed');
    }
    await this.cache.set(lockKey, '1', PAYMENT_LOCK_TTL);

    try {
      const paymentId = generateId();
      const payment = await this.paymentRepo.create({
        id: paymentId,
        userId,
        planId,
        provider,
        status: 'pending',
        amount,
        currency,
        isIdempotent: true,
      });

      logger.info({ paymentId: payment.id, userId, planId, provider }, 'Payment created');

      return {
        paymentId: payment.id,
        provider: payment.provider,
        status: payment.status,
      };
    } finally {
      await this.cache.delete(lockKey);
    }
  }

  async verifyPayment(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return false;
    return payment.status === 'completed';
  }

  async handleWebhook(provider: PaymentProvider, payload: unknown): Promise<PaymentResult> {
    const logger = getLogger();
    logger.info({ provider }, 'Processing payment webhook');

    const webhookData = payload as Record<string, unknown>;
    const externalId = webhookData['externalId'] as string | undefined;
    const status = webhookData['status'] as PaymentStatus | undefined;

    if (!externalId) {
      throw new PaymentError('Missing external ID in webhook');
    }

    const payment = await this.paymentRepo.findByExternalId(externalId);
    if (!payment) {
      throw new PaymentError(`Payment not found for external ID: ${externalId}`);
    }

    // Prevent double activation
    if (payment.status === 'completed') {
      logger.info({ paymentId: payment.id }, 'Payment already completed, skipping');
      return {
        paymentId: payment.id,
        provider: payment.provider,
        status: payment.status,
      };
    }

    if (status === 'completed') {
      await this.paymentRepo.update(payment.id, {
        status: 'completed',
        externalPaymentId: externalId,
        completedAt: new Date(),
      });
    } else if (status === 'failed') {
      await this.paymentRepo.update(payment.id, {
        status: 'failed',
        externalPaymentId: externalId,
      });
    }

    return {
      paymentId: payment.id,
      provider: payment.provider,
      status: status ?? payment.status,
    };
  }

  async cancelPayment(paymentId: string): Promise<void> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new PaymentError(`Payment not found: ${paymentId}`);
    }

    if (payment.status === 'completed') {
      throw new PaymentError('Cannot cancel completed payment');
    }

    await this.paymentRepo.update(paymentId, { status: 'failed' });
  }

  async markAsCompleted(paymentId: string, externalId: string): Promise<Payment> {
    const logger = getLogger();
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) {
      throw new PaymentError(`Payment not found: ${paymentId}`);
    }

    if (payment.status === 'completed') {
      logger.info({ paymentId }, 'Payment already completed');
      return payment;
    }

    const updated = await this.paymentRepo.update(paymentId, {
      status: 'completed',
      externalPaymentId: externalId,
      completedAt: new Date(),
    });

    logger.info({ paymentId }, 'Payment marked as completed');
    return updated;
  }
}
