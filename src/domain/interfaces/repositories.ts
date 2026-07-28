import type { User } from '../entities/User.js';
import type { Plan } from '../entities/Plan.js';
import type { Subscription } from '../entities/Subscription.js';
import type { Payment } from '../entities/Payment.js';
import type { AuditLog } from '../entities/AuditLog.js';
import type { NotificationLog } from '../entities/NotificationLog.js';
import type {
  SubscriptionStatus,
  PaymentStatus,
  PaymentProvider,
  PlanType,
} from '../../shared/types/index.js';

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByTelegramId(telegramId: number): Promise<User | null>;
  findAll(): Promise<User[]>;
  count(): Promise<number>;
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
  findAll(): Promise<Subscription[]>;
  count(): Promise<number>;
  create(subscription: Partial<Subscription>): Promise<Subscription>;
  update(id: string, data: Partial<Subscription>): Promise<Subscription>;
  findExpiringSoon(hours: number): Promise<Subscription[]>;
  /** Активные подписки, заканчивающиеся в ближайшие `days` дней (включительно). */
  findActiveExpiringWithinDays(days: number): Promise<Subscription[]>;
  /**
   * Из переданных userId возвращает те, у кого есть хотя бы одна подписка (любого статуса).
   * Один запрос вместо findByUserId() на каждого пользователя по отдельности.
   */
  findUserIdsWithSubscriptions(userIds: string[]): Promise<Set<string>>;
}

export interface RevenueBreakdownEntry {
  provider: PaymentProvider;
  currency: string | null;
  total: number;
  count: number;
}

export interface RevenueSummary {
  today: RevenueBreakdownEntry[];
  last7Days: RevenueBreakdownEntry[];
  last30Days: RevenueBreakdownEntry[];
  allTime: RevenueBreakdownEntry[];
}

export interface IPaymentRepository {
  findById(id: string): Promise<Payment | null>;
  findByExternalId(externalId: string): Promise<Payment | null>;
  findByUserId(userId: string): Promise<Payment[]>;
  findPendingByUserId(userId: string): Promise<Payment | null>;
  findPendingByProvider(provider: PaymentProvider): Promise<Payment[]>;
  findAll(): Promise<Payment[]>;
  count(): Promise<number>;
  create(payment: Partial<Payment>): Promise<Payment>;
  update(id: string, data: Partial<Payment>): Promise<Payment>;
  findCompletedByUserIdAndPlanId(userId: string, planId: string): Promise<Payment | null>;
  /**
   * Доход по завершённым платежам (status='completed', сгруппировано по
   * provider+currency — валюты не суммируются вместе, т.к. XTR и RUB
   * несопоставимы), за 4 окна: сегодня / 7д / 30д / всё время. Для веб-админки.
   */
  getRevenueSummary(): Promise<RevenueSummary>;
}

export interface IAuditLogRepository {
  create(log: Partial<AuditLog>): Promise<AuditLog>;
  findByUserId(userId: string, limit: number): Promise<AuditLog[]>;
  findAll(options?: {
    limit?: number;
    skip?: number;
    order?: { [key: string]: 'ASC' | 'DESC' };
  }): Promise<AuditLog[]>;
  count(): Promise<number>;
}

export type SubscriptionStatusFilter = SubscriptionStatus;
export type PaymentStatusFilter = PaymentStatus;
export type PaymentProviderFilter = PaymentProvider;

export interface INotificationLogRepository {
  create(log: Partial<NotificationLog>): Promise<NotificationLog>;
  /** Проверяет, было ли уже отправлено уведомление с заданным ключом дедупликации. */
  exists(
    userId: string,
    type: NotificationLog['type'],
    options?: { entityId?: string | null; cycleKey?: string | null },
  ): Promise<boolean>;
  findByUserAndType(
    userId: string,
    type: NotificationLog['type'],
  ): Promise<NotificationLog[]>;
  /** Общее количество записей в журнале уведомлений. */
  countAll(): Promise<number>;
  /** Список уведомлений с пагинацией (для админ-панели). */
  findAll(options?: {
    limit?: number;
    skip?: number;
    order?: { [key: string]: 'ASC' | 'DESC' };
  }): Promise<NotificationLog[]>;
  /** Агрегированная статистика по типам и статусам доставки. */
  getStats(): Promise<{
    total: number;
    delivered: number;
    failed: number;
    byType: Array<{ type: NotificationLog['type']; total: number; delivered: number }>;
  }>;
}
