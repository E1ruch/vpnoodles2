import type { Telegraf } from 'telegraf';
import type { PurchasePlanUseCase } from '../../application/usecases/PurchasePlanUseCase.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import { getLogger } from '../../shared/logger/index.js';
import { SubscriptionError, PaymentLockedError } from '../../shared/errors/index.js';
import { YooKassaService } from './YooKassaService.js';
import { sendSubscriptionDelivered } from '../../transport/telegram/user/subscriptionDelivery.js';

export interface YooKassaFulfillmentDeps {
  paymentRepo: IPaymentRepository;
  purchasePlanUseCase: PurchasePlanUseCase;
  userRepo: IUserRepository;
  bot: Telegraf;
}

function isUuidLooksLikeYooKassaPaymentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export async function runYooKassaFulfillmentTick(
  deps: YooKassaFulfillmentDeps,
  yooKassa: YooKassaService,
  options?: { filterUserId?: string; sendTelegramNotification?: boolean },
): Promise<{ checked: number; fulfilled: number }> {
  const logger = getLogger();
  const sendNotify = options?.sendTelegramNotification !== false;

  if (!yooKassa.isConfigured()) {
    return { checked: 0, fulfilled: 0 };
  }

  let pending;
  if (options?.filterUserId) {
    const row = await deps.paymentRepo.findPendingByUserId(options.filterUserId);
    pending = row?.provider === 'yookassa' ? [row] : [];
  } else {
    pending = await deps.paymentRepo.findPendingByProvider('yookassa');
  }

  logger.info({ pendingCount: pending.length, filterUserId: options?.filterUserId }, 'YooKassa fulfillment tick');

  let fulfilled = 0;

  for (const p of pending) {
    try {
      let yooId = (p.externalPaymentId ?? '').trim();

      if (!yooId || yooId.startsWith('http') || !isUuidLooksLikeYooKassaPaymentId(yooId)) {
        const resolved = await yooKassa.resolvePaymentByOurInternalId(p.id);
        if (!resolved) {
          logger.debug({ paymentId: p.id }, 'YooKassa: payment not found by internalPaymentId (yet)');
          continue;
        }
        yooId = resolved.id;
        await deps.paymentRepo.update(p.id, { externalPaymentId: yooId });
      }

      const remote = await yooKassa.fetchPayment(yooId);

      if (remote.status === 'succeeded') {
        const result = await deps.purchasePlanUseCase.execute(p.userId, p.planId, 'yookassa', {
          existingPaymentId: p.id,
          externalChargeId: yooId,
        });
        fulfilled += 1;
        logger.info({ paymentId: p.id, userId: p.userId }, 'YooKassa payment fulfilled');

        if (sendNotify) {
          const user = await deps.userRepo.findById(p.userId);
          if (user) {
            try {
              await sendSubscriptionDelivered(
                deps.bot.telegram,
                user.telegramId,
                result.subscriptionId,
                result.subscriptionUrl,
              );
            } catch (notifyErr) {
              logger.warn({ notifyErr, telegramId: user.telegramId }, 'Failed to notify user after YooKassa fulfill');
            }
          }
        }
      } else if (remote.status === 'canceled') {
        await deps.paymentRepo.update(p.id, { status: 'failed' });
        logger.info({ paymentId: p.id }, 'YooKassa payment canceled → failed');
      } else if (remote.status === 'waiting_for_capture') {
        logger.debug({ paymentId: p.id, yooId }, 'YooKassa waiting_for_capture, skip');
      }
    } catch (err) {
      if (err instanceof PaymentLockedError) {
        // Этот же платёж прямо сейчас фулфилится другим вызовом (webhook или
        // соседний polling-тик) — это не ошибка, а сработавшая защита от гонки.
        // Просто пропускаем, следующий тик увидит уже завершённый платёж.
        logger.debug({ paymentId: p.id }, 'YooKassa: payment fulfillment locked elsewhere, skip');
        continue;
      }
      if (
        err instanceof SubscriptionError &&
        err.message === 'User already has active paid subscription'
      ) {
        await deps.paymentRepo.update(p.id, {
          status: 'completed',
          completedAt: new Date(),
        });
        logger.info(
          { paymentId: p.id, userId: p.userId },
          'YooKassa payment already covered by active paid subscription, marked as completed',
        );
        continue;
      }
      logger.warn({ err, paymentId: p.id }, 'YooKassa fulfillment row failed');
    }
  }

  return { checked: pending.length, fulfilled };
}
