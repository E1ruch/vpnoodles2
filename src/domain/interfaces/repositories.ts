import type { User } from '../entities/User.js';
import type { Plan } from '../entities/Plan.js';
import type { Subscription } from '../entities/Subscription.js';
import type { Payment } from '../entities/Payment.js';
import type { AuditLog } from '../entities/AuditLog.js';
import type { NotificationLog } from '../entities/NotificationLog.js';
import type { ReferralReward, ReferralRewardType } from '../entities/ReferralReward.js';
import type { ReferralSettings } from '../entities/ReferralSettings.js';
import type { ServerCost } from '../entities/ServerCost.js';
import type {
  SubscriptionStatus,
  PaymentStatus,
  PaymentProvider,
  PlanType,
} from '../../shared/types/index.js';

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByTelegramId(telegramId: number): Promise<User | null>;
  findAll(): Promise<User[]>;
  /** Батч-резолв по id (для лейблов в списках логов/уведомлений — без N+1). */
  findByIds(ids: string[]): Promise<User[]>;
  count(): Promise<number>;
  create(user: Partial<User>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  /**
   * Поиск для веб-админки: если search — число, точное совпадение по
   * telegramId; иначе ILIKE по username/firstName/lastName.
   */
  searchPaginated(params: { search?: string; skip: number; limit: number }): Promise<Paginated<User>>;
  /** Кол-во пользователей, зарегистрированных строго до `date` — базовая точка для кумулятивного графика роста. */
  countCreatedBefore(date: Date): Promise<number>;
  /** Новые регистрации по дням начиная с `since` (включительно), для графика роста. Дни без регистраций не возвращаются. */
  getDailyRegistrations(since: Date): Promise<Array<{ date: string; count: number }>>;
  /** Реферальная программа: поиск по короткому реферальному коду. */
  findByReferralCode(code: string): Promise<User | null>;
  /** Реферальная программа: лениво генерирует код при первом обращении (§5.2 плана), ретраит на коллизию. */
  getOrCreateReferralCode(userId: string): Promise<string>;
  /** Реферальная программа: сколько пользователей указали этого пользователя как referredByUserId. */
  countReferredBy(userId: string): Promise<number>;
}

export interface IPlanRepository {
  findById(id: string): Promise<Plan | null>;
  findByType(type: PlanType): Promise<Plan[]>;
  findActive(): Promise<Plan[]>;
  /** Все планы (включая неактивные), отсортированные по sortOrder — для веб-админки. */
  findAll(): Promise<Plan[]>;
  create(plan: Partial<Plan>): Promise<Plan>;
  update(id: string, data: Partial<Plan>): Promise<Plan>;
  /** Бросает PlanInUseError, если на план ещё ссылаются subscriptions/payments (FK 23503). */
  delete(id: string): Promise<void>;
}

export interface ISubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  findActiveByUserId(userId: string): Promise<Subscription | null>;
  findByUserId(userId: string): Promise<Subscription[]>;
  findAll(): Promise<Subscription[]>;
  count(): Promise<number>;
  create(subscription: Partial<Subscription>): Promise<Subscription>;
  update(id: string, data: Partial<Subscription>): Promise<Subscription>;
  /** Активные подписки, заканчивающиеся в ближайшие `days` дней (включительно). */
  findActiveExpiringWithinDays(days: number): Promise<Subscription[]>;
  /**
   * Из переданных userId возвращает те, у кого есть хотя бы одна подписка (любого статуса).
   * Один запрос вместо findByUserId() на каждого пользователя по отдельности.
   */
  findUserIdsWithSubscriptions(userIds: string[]): Promise<Set<string>>;
  /** Кол-во активных подписок по каждому planId — для статистики на странице планов в веб-админке. */
  countActiveByPlan(): Promise<Array<{ planId: string; count: number }>>;
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
  /** Кол-во завершённых платежей пользователя — для проверки «это первая оплата» (реферальная программа, §5.4). */
  countCompletedByUserId(userId: string): Promise<number>;
  /**
   * Доход по завершённым платежам (status='completed', сгруппировано по
   * provider+currency — валюты не суммируются вместе, т.к. XTR и RUB
   * несопоставимы), за 4 окна: сегодня / 7д / 30д / всё время. Для веб-админки.
   */
  getRevenueSummary(): Promise<RevenueSummary>;
  /** Пагинированный список платежей (с user+plan) для веб-админки, опционально по статусу. */
  findPaginated(params: { skip: number; limit: number; status?: PaymentStatus }): Promise<Paginated<Payment>>;
  /**
   * Доход в рублях (status='completed', currency='RUB') по календарным месяцам
   * за последние `months` месяцев, включая текущий. Для сравнения с расходами
   * на сервера в веб-админке (§ServerCost) — в отличие от getRevenueSummary()
   * это фиксированные календарные месяцы, а не скользящие окна.
   */
  getMonthlyRevenueRub(months: number): Promise<Array<{ month: string; totalRub: number }>>;
}

export interface IServerCostRepository {
  findAll(): Promise<ServerCost[]>;
  findByNodeUuid(nodeUuid: string): Promise<ServerCost | null>;
  upsert(
    nodeUuid: string,
    data: { monthlyCostRub: number; nextPaymentDate: Date | null; note: string | null; nodeName: string | null },
  ): Promise<ServerCost>;
  deleteByNodeUuid(nodeUuid: string): Promise<void>;
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
  /** Общее количество записей в журнале уведомлений, опционально по типу. */
  countAll(options?: { type?: NotificationLog['type'] }): Promise<number>;
  /** Список уведомлений с пагинацией (для админ-панели), опционально по типу. */
  findAll(options?: {
    limit?: number;
    skip?: number;
    order?: { [key: string]: 'ASC' | 'DESC' };
    type?: NotificationLog['type'];
  }): Promise<NotificationLog[]>;
  /** Агрегированная статистика по типам и статусам доставки. */
  getStats(): Promise<{
    total: number;
    delivered: number;
    failed: number;
    byType: Array<{ type: NotificationLog['type']; total: number; delivered: number }>;
  }>;
}

export interface ReferralTopReferrerRow {
  referrerUserId: string;
  invitedCount: number;
  convertedCount: number;
  totalDaysGranted: number;
}

export interface ReferralRewardStats {
  totalReferred: number;
  totalConverted: number;
  totalDaysGranted: number;
  totalPendingDays: number;
}

export interface IReferralRewardRepository {
  create(reward: Partial<ReferralReward>): Promise<ReferralReward>;
  update(id: string, data: Partial<ReferralReward>): Promise<void>;
  /** Для 30-дневного rolling-кэпа (§2.6) — только успешно начисленные ('granted') конверсионные награды. */
  countCompletedConversionsSince(referrerUserId: string, since: Date): Promise<number>;
  /** Для rate-кэпа сигнап-наград (§2.2) — сколько 'referrer_signup' начислений за окно. */
  countRewardsSince(
    referrerUserId: string,
    rewardType: ReferralRewardType,
    since: Date,
  ): Promise<number>;
  /** Сумма daysGranted среди pending_claim-строк этого реферера — для кэпа «банка» (§2.6). */
  sumPendingDays(referrerUserId: string): Promise<number>;
  /** То же самое, но по всем пользователям сразу — для KPI «Ожидают получения» в админ-панели (§7.2). */
  sumPendingDaysTotal(): Promise<number>;
  /** Сумма trafficGbGranted среди granted-строк заданного типа — для soft-ceiling стэкинга ГБ/день. */
  sumGrantedTrafficGb(referrerUserId: string, rewardType: ReferralRewardType): Promise<number>;
  /** Сумма daysGranted среди granted-строк по всем типам — для карточки статистики в разделе "Рефералы". */
  sumGrantedDaysTotal(referrerUserId: string): Promise<number>;
  /** Сумма trafficGbGranted среди granted-строк по всем типам — для карточки статистики в разделе "Рефералы". */
  sumGrantedTrafficGbTotal(referrerUserId: string): Promise<number>;
  findPendingByReferrer(referrerUserId: string): Promise<ReferralReward[]>;
  markClaimed(ids: string[], creditedSubscriptionId: string): Promise<void>;
  /** Уже начисленные (не pending/capped/failed) конверсионные награды referredUserId — для подсчёта convertedCount. */
  countConvertedReferrals(referrerUserId: string): Promise<number>;
  findByReferrer(
    referrerUserId: string,
    options?: { limit?: number; skip?: number },
  ): Promise<Paginated<ReferralReward>>;
  findAll(options?: { limit?: number; skip?: number }): Promise<Paginated<ReferralReward>>;
  getTopReferrers(limit: number): Promise<ReferralTopReferrerRow[]>;
  getStats(): Promise<ReferralRewardStats>;
}

export interface IReferralSettingsRepository {
  /** Единственная строка настроек; создаётся с дефолтами при первом обращении, если ещё не существует. */
  get(): Promise<ReferralSettings>;
  update(data: Partial<ReferralSettings>): Promise<ReferralSettings>;
}
