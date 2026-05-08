import { getLogger } from '../../shared/logger/index.js';
import { PaymentError } from '../../shared/errors/index.js';
import { getEnv } from '../../shared/config/env.js';
import { generateId } from '../../shared/utils/index.js';
import type { PaymentResult, PaymentProvider } from '../../shared/types/index.js';

interface YooKassaPayment {
  id: string;
  status: string;
  amount: {
    value: string;
    currency: string;
  };
  confirmation?: {
    type: string;
    confirmation_url?: string;
  };
  metadata?: Record<string, string>;
}

interface CreatePaymentOptions {
  userId: string;
  planId: string;
  planName: string;
  amount: number;
  currency: string;
  description: string;
  internalPaymentId?: string;
}

export class YooKassaService {
  private shopId: string | undefined;
  private secretKey: string | undefined;
  private webhookUrl: string | undefined;

  constructor() {
    const env = getEnv();
    this.shopId = env.YOOKASSA_SHOP_ID;
    this.secretKey = env.YOOKASSA_SECRET_KEY;
    this.webhookUrl = env.YOOKASSA_WEBHOOK_URL;
  }

  isConfigured(): boolean {
    return !!(this.shopId && this.secretKey);
  }

  async fetchPayment(yooKassaPaymentId: string): Promise<YooKassaPayment> {
    const logger = getLogger();

    if (!this.isConfigured()) {
      throw new PaymentError('YooKassa is not configured');
    }

    const response = await fetch(`https://api.yookassa.ru/v3/payments/${yooKassaPaymentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'YooKassa GET payment error');
      throw new PaymentError(`YooKassa API error: ${response.status}`);
    }

    return (await response.json()) as YooKassaPayment;
  }

  async getConfirmationUrl(yooKassaPaymentId: string): Promise<string | undefined> {
    const payment = await this.fetchPayment(yooKassaPaymentId);
    return payment.confirmation?.confirmation_url;
  }

  /**
   * Ищет платёж в ЮKassa по metadata.internalPaymentId (UUID нашей строки в payments).
   * Нужен для polling без webhook и если в БД потеряли externalPaymentId.
   */
  async resolvePaymentByOurInternalId(internalPaymentId: string): Promise<YooKassaPayment | null> {
    const logger = getLogger();

    if (!this.isConfigured()) {
      throw new PaymentError('YooKassa is not configured');
    }

    let cursor: string | undefined;
    const maxPages = 8;

    for (let page = 0; page < maxPages; page++) {
      const url = new URL('https://api.yookassa.ru/v3/payments');
      url.searchParams.set('limit', '50');
      if (cursor) url.searchParams.set('cursor', cursor);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'YooKassa list payments error');
        throw new PaymentError(`YooKassa API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        items?: YooKassaPayment[];
        next_cursor?: string;
      };

      const found = data.items?.find(
        (item) => item.metadata?.['internalPaymentId'] === internalPaymentId,
      );
      if (found) return found;

      cursor = data.next_cursor;
      if (!cursor) break;
    }

    return null;
  }

  async createPayment(options: CreatePaymentOptions): Promise<PaymentResult> {
    const logger = getLogger();

    if (!this.isConfigured()) {
      throw new PaymentError('YooKassa is not configured');
    }

    const idempotenceKey = generateId();
    const internalPaymentId = options.internalPaymentId ?? idempotenceKey;

    try {
      const response = await fetch('https://api.yookassa.ru/v3/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotence-Key': idempotenceKey,
          // Basic auth: shopId:secretKey
          Authorization: `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`,
        },
        body: JSON.stringify({
          amount: {
            value: options.amount.toString(),
            currency: options.currency,
          },
          confirmation: {
            type: 'redirect',
            return_url: this.webhookUrl ?? 'https://t.me/your_bot',
          },
          capture: true,
          description: options.description,
          metadata: {
            userId: options.userId,
            planId: options.planId,
            internalPaymentId,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'YooKassa API error');
        throw new PaymentError(`YooKassa API error: ${response.status}`);
      }

      const payment = (await response.json()) as YooKassaPayment;
      logger.info({ paymentId: payment.id, status: payment.status }, 'YooKassa payment created');

      return {
        paymentId: internalPaymentId,
        provider: 'yookassa' as PaymentProvider,
        status: 'pending',
        url: payment.confirmation?.confirmation_url,
        externalId: payment.id,
      };
    } catch (error) {
      logger.error({ error }, 'YooKassa payment creation failed');
      if (error instanceof PaymentError) throw error;
      throw new PaymentError('Failed to create YooKassa payment');
    }
  }

  async verifyPayment(paymentId: string): Promise<{ status: string; externalId?: string }> {
    const logger = getLogger();

    if (!this.isConfigured()) {
      throw new PaymentError('YooKassa is not configured');
    }

    try {
      // Для верификации нужно найти платёж по metadata.internalPaymentId
      // YooKassa не позволяет искать по idempotence key, поэтому используем webhook
      logger.info({ paymentId }, 'Verifying YooKassa payment');
      return { status: 'pending' };
    } catch (error) {
      logger.error({ error }, 'YooKassa payment verification failed');
      throw new PaymentError('Failed to verify YooKassa payment');
    }
  }

  async handleWebhook(payload: unknown): Promise<{ 
    internalPaymentId: string; 
    externalId: string; 
    status: 'completed' | 'failed' | 'pending';
    userId: string;
    planId: string;
  }> {
    const logger = getLogger();

    const data = payload as Record<string, unknown>;
    const event = data['event'] as string;
    const payment = data['object'] as YooKassaPayment | undefined;

    if (!payment) {
      throw new PaymentError('Invalid webhook payload');
    }

    logger.info({ event, paymentId: payment.id }, 'Processing YooKassa webhook');

    const metadata = payment.metadata ?? {};
    const internalPaymentId = metadata['internalPaymentId'] ?? payment.id;
    const userId = metadata['userId'] ?? '';
    const planId = metadata['planId'] ?? '';

    let status: 'completed' | 'failed' | 'pending' = 'pending';

    if (event === 'payment.succeeded' || payment.status === 'succeeded') {
      status = 'completed';
    } else if (event === 'payment.canceled' || payment.status === 'canceled') {
      status = 'failed';
    }

    return {
      internalPaymentId,
      externalId: payment.id,
      status,
      userId,
      planId,
    };
  }
}