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
  externalId?: string;
}

export interface VpnCredentials {
  subscriptionUrl: string;
  qrCodeBase64: string;
}

export interface PlanDuration {
  days: number;
  label: string;
}

export interface HwidDevice {
  hwid: string;
  userUuid: string;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HwidDevicesResult {
  total: number;
  devices: HwidDevice[];
}

export interface RemnawaveNodeInterfaceStats {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface RemnawaveNodeStats {
  memoryFree: number;
  memoryUsed: number;
  uptime: number;
  loadAvg: number[];
  interface?: RemnawaveNodeInterfaceStats;
}

export interface RemnawaveNode {
  uuid: string;
  name: string;
  usersOnline: number;
  isConnected: boolean;
  isDisabled: boolean;
  isConnecting: boolean;
  versions?: {
    xray?: string;
  };
  system?: {
    stats?: RemnawaveNodeStats;
  };
}
