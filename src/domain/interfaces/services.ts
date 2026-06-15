import type {
  VpnCredentials,
  PaymentResult,
  PaymentProvider,
  HwidDevicesResult,
  RemnawaveNode,
} from '../../shared/types/index.js';

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
      deviceLimit?: number;
    },
  ): Promise<string>;
  deleteUser(remnawaveUserId: string): Promise<void>;
  suspendUser(remnawaveUserId: string): Promise<void>;
  resumeUser(remnawaveUserId: string): Promise<void>;
  getSubscriptionUrl(remnawaveUserId: string): Promise<string>;
  updateDeviceLimit(remnawaveUserId: string, limit: number): Promise<void>;
  updateUserTag(remnawaveUserId: string, tag: string): Promise<void>;
  extendUser(remnawaveUserId: string, days: number): Promise<void>;
  upgradeUser(
    remnawaveUserId: string,
    options: {
      tag: string;
      deviceLimit: number;
      trafficLimitBytes: number;
      trafficLimitStrategy: 'NO_RESET' | 'DAY' | 'MONTH';
      expireAt: Date;
    },
  ): Promise<void>;
  /** GET /api/users/{uuid} → expireAt и статус для зеркала в БД. */
  getUserSubscriptionState(
    remnawaveUserUuid: string,
  ): Promise<{ expireAt: Date; status: 'active' | 'expired' } | null>;
  /** GET /api/users/{uuid} → expireAt. */
  getUserExpireAt(remnawaveUserUuid: string): Promise<Date | null>;
  /** GET /api/hwid/devices/{userUuid} → response.total (количество устройств). */
  getHwidDeviceTotal(remnawaveUserUuid: string): Promise<number>;
  /** GET /api/hwid/devices/{userUuid} → список устройств. */
  getHwidDevices(remnawaveUserUuid: string): Promise<HwidDevicesResult>;
  /** POST /api/hwid/devices/delete — удаление устройства по hwid. */
  deleteHwidDevice(remnawaveUserUuid: string, hwid: string): Promise<HwidDevicesResult>;
  /** GET /api/nodes — список VPN-нод. */
  getNodes(): Promise<RemnawaveNode[]>;
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
