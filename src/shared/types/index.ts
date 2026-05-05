export type SubscriptionStatus = 'active' | 'expired' | 'suspended' | 'pending';
export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';
export type PaymentProvider = 'stars' | 'yookassa' | 'crypto';
export type PlanType = 'trial' | 'paid';

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export interface PaymentResult {
  paymentId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  url?: string;
}

export interface VpnCredentials {
  subscriptionUrl: string;
  qrCodeBase64: string;
}

export interface PlanDuration {
  days: number;
  label: string;
}
