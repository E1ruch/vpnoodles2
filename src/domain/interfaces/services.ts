import type { VpnCredentials, PaymentResult, PaymentProvider } from '../../shared/types/index.js';

export interface IRemnawaveService {
  findUserByUsername(username: string): Promise<string | null>;
  createUser(
    telegramId: number,
    username: string,
    tag: string,
    activeInternalSquads: string[],
    options?: {
      trafficLimitBytes?: number;
      trafficLimitStrategy?: 'NO_RESET' | 'DAY' | 'MONTH';
      expireAt?: Date;
    },
  ): Promise<string>;
  deleteUser(remnawaveUserId: string): Promise<void>;
  suspendUser(remnawaveUserId: string): Promise<void>;
  resumeUser(remnawaveUserId: string): Promise<void>;
  getSubscriptionUrl(remnawaveUserId: string): Promise<string>;
  updateDeviceLimit(remnawaveUserId: string, limit: number): Promise<void>;
  updateUserTag(remnawaveUserId: string, tag: string): Promise<void>;
  extendUser(remnawaveUserId: string, days: number): Promise<void>;
}

export interface IPaymentService {
  createPayment(
    userId: string,
    planId: string,
    provider: PaymentProvider,
    amount: number,
    currency: string,
  ): Promise<PaymentResult>;
  verifyPayment(paymentId: string): Promise<boolean>;
  handleWebhook(provider: PaymentProvider, payload: unknown): Promise<PaymentResult>;
  cancelPayment(paymentId: string): Promise<void>;
  markAsCompleted(
    paymentId: string,
    externalId: string,
  ): Promise<import('../entities/Payment.js').Payment>;
}

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface IQRCodeService {
  generateBase64(data: string): Promise<string>;
}
