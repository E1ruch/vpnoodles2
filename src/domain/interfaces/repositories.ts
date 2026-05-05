import type { User } from '../entities/User.js';
import type { Plan } from '../entities/Plan.js';
import type { Subscription } from '../entities/Subscription.js';
import type { Payment } from '../entities/Payment.js';
import type { AuditLog } from '../entities/AuditLog.js';
import type {
  SubscriptionStatus,
  PaymentStatus,
  PaymentProvider,
  PlanType,
} from '../../shared/types/index.js';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByTelegramId(telegramId: number): Promise<User | null>;
  create(user: Partial<User>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
}

export interface IPlanRepository {
  findById(id: string): Promise<Plan | null>;
  findByType(type: PlanType): Promise<Plan[]>;
  findActive(): Promise<Plan[]>;
  create(plan: Partial<Plan>): Promise<Plan>;
}

export interface ISubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  findActiveByUserId(userId: string): Promise<Subscription | null>;
  findByUserId(userId: string): Promise<Subscription[]>;
  create(subscription: Partial<Subscription>): Promise<Subscription>;
  update(id: string, data: Partial<Subscription>): Promise<Subscription>;
  findExpiringSoon(hours: number): Promise<Subscription[]>;
}

export interface IPaymentRepository {
  findById(id: string): Promise<Payment | null>;
  findByExternalId(externalId: string): Promise<Payment | null>;
  findByUserId(userId: string): Promise<Payment[]>;
  findPendingByUserId(userId: string): Promise<Payment | null>;
  create(payment: Partial<Payment>): Promise<Payment>;
  update(id: string, data: Partial<Payment>): Promise<Payment>;
  findCompletedByUserIdAndPlanId(userId: string, planId: string): Promise<Payment | null>;
}

export interface IAuditLogRepository {
  create(log: Partial<AuditLog>): Promise<AuditLog>;
  findByUserId(userId: string, limit: number): Promise<AuditLog[]>;
}

export type SubscriptionStatusFilter = SubscriptionStatus;
export type PaymentStatusFilter = PaymentStatus;
export type PaymentProviderFilter = PaymentProvider;
