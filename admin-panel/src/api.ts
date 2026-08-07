export interface RevenueBreakdownEntry {
  provider: string;
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

export interface RemnawaveNodeSummary {
  uuid: string;
  name: string;
  isConnected: boolean;
  isConnecting: boolean;
  isDisabled: boolean;
  usersOnline: number;
}

export interface AdminOverview {
  usersCount: number;
  activeUsersCount: number;
  subscriptionsCount: number;
  activeSubscriptionsCount: number;
  paymentsCount: number;
  logsCount: number;
  revenue: RevenueSummary;
  notifications: {
    total: number;
    delivered: number;
    failed: number;
    byType: Array<{ type: string; total: number; delivered: number }>;
  };
  nodes: RemnawaveNodeSummary[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserListEntry {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  hasUsedTrial: boolean;
  createdAt: string;
}

export interface UserDetailReferralReward {
  id: string;
  referrerUserId: string;
  referrerLabel: string;
  referredUserId: string;
  referredLabel: string;
  rewardType: string;
  daysGranted: number;
  trafficGbGranted: number;
  status: string;
  createdAt: string;
}

export interface UserDetailReferral {
  referredByUserId: string | null;
  referredByLabel: string | null;
  invitedCount: number;
  rewards: UserDetailReferralReward[];
}

export interface UserDetail {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  languageCode: string | null;
  isActive: boolean;
  hasUsedTrial: boolean;
  createdAt: string;
  referral: UserDetailReferral;
  subscriptions: Array<{
    id: string;
    planName: string;
    /** 'paid' — трафик безлимитный по дизайну (см. PurchasePlanUseCase). */
    planType: 'trial' | 'paid' | null;
    status: string;
    startDate: string;
    endDate: string;
    deviceLimit: number;
    usedDevices: number;
    isActive: boolean;
  }>;
  payments: Array<{
    id: string;
    planLabel: string;
    amount: number;
    currency: string | null;
    provider: string;
    status: string;
    createdAt: string;
  }>;
  recentActions: Array<{
    id: string;
    action: string;
    entityType: string | null;
    entityId: string | null;
    createdAt: string;
  }>;
}

export interface PaymentListEntry {
  id: string;
  userId: string;
  userLabel: string;
  planLabel: string;
  amount: number;
  currency: string | null;
  provider: string;
  status: string;
  createdAt: string;
}

export interface NotificationLogEntry {
  id: string;
  userId: string;
  userLabel: string;
  type: string;
  delivered: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userLabel: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface SendCustomNotificationReward {
  extraDays?: number;
  newTrafficLimitGb?: number;
}

export interface SendCustomNotificationPayload {
  audience: 'user' | 'all';
  userId?: string;
  text: string;
  button?: { label: string; url: string } | null;
  /** Только при audience === 'user'. */
  reward?: SendCustomNotificationReward | null;
}

export interface SendCustomNotificationResult {
  audience: 'user' | 'all';
  recipients: number;
  sent: number;
  failed: number;
  /** true только для audience === 'all' — рассылка продолжается в фоне, итог — в /logs. */
  queued: boolean;
  /** Что реально было выдано пользователю, если был указан reward, иначе null. */
  rewardApplied: Record<string, unknown> | null;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Request to ${path} failed with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getAuthConfig(): Promise<{ botUsername: string; devLoginEnabled: boolean }> {
  return apiFetch('/api/auth/config');
}

export function getMe(): Promise<{ telegramId: number }> {
  return apiFetch('/api/auth/me');
}

export function loginWithTelegram(payload: Record<string, unknown>): Promise<{ ok: true }> {
  return apiFetch('/api/auth/telegram', { method: 'POST', body: JSON.stringify(payload) });
}

/** Только для локальной разработки — см. ADMIN_DEV_USERNAME/ADMIN_DEV_PASSWORD в .env.example. */
export function loginWithPassword(username: string, password: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export function getOverview(): Promise<AdminOverview> {
  return apiFetch('/api/overview');
}

export interface UsersGrowthPoint {
  date: string;
  newUsers: number;
  totalUsers: number;
}

export interface UsersGrowthResult {
  days: number;
  series: UsersGrowthPoint[];
}

export function getUsersGrowth(days: 7 | 30 | 90): Promise<UsersGrowthResult> {
  return apiFetch(`/api/overview/users-growth?days=${days}`);
}

export type SystemStatus = 'ok' | 'warning' | 'critical';
export type ComponentStatus = 'ok' | 'critical';

export interface SystemComponentHealth {
  name: 'postgres' | 'redis' | 'telegram_bot' | 'remnawave';
  label: string;
  status: ComponentStatus;
  latencyMs: number | null;
  message: string | null;
}

export interface SystemHealthResult {
  status: SystemStatus;
  checkedAt: string;
  vps: {
    cpuPercent: number;
    loadAverage: [number, number, number];
    memory: { usedBytes: number; totalBytes: number };
    disk: { usedBytes: number; totalBytes: number };
    uptimeSeconds: number;
  };
  components: SystemComponentHealth[];
  warnings: string[];
  recentErrors: Array<{ time: string; message: string }>;
}

export function getSystemHealth(): Promise<SystemHealthResult> {
  return apiFetch('/api/system-health');
}

export function getUsers(params: { search?: string; page: number; pageSize: number }): Promise<Paginated<UserListEntry>> {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiFetch(`/api/users?${query.toString()}`);
}

export function getUser(id: string): Promise<UserDetail> {
  return apiFetch(`/api/users/${id}`);
}

export function getPayments(params: {
  status?: string;
  page: number;
  pageSize: number;
}): Promise<Paginated<PaymentListEntry>> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiFetch(`/api/payments?${query.toString()}`);
}

export function getNotificationLogs(params: {
  type?: string;
  page: number;
  pageSize: number;
}): Promise<Paginated<NotificationLogEntry>> {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiFetch(`/api/notifications?${query.toString()}`);
}

export function getAuditLogs(params: { page: number; pageSize: number }): Promise<Paginated<AuditLogEntry>> {
  const query = new URLSearchParams();
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiFetch(`/api/logs?${query.toString()}`);
}

export function sendCustomNotification(
  payload: SendCustomNotificationPayload,
): Promise<SendCustomNotificationResult> {
  return apiFetch('/api/notifications/custom', { method: 'POST', body: JSON.stringify(payload) });
}

export function getAudienceCount(audience: 'all'): Promise<{ count: number }> {
  return apiFetch(`/api/notifications/custom/audience-count?audience=${audience}`);
}

export interface ReferralStats {
  totalReferred: number;
  totalConverted: number;
  totalDaysGranted: number;
  totalPendingDays: number;
}

export interface TopReferrerEntry {
  referrerUserId: string;
  userLabel: string;
  invitedCount: number;
  convertedCount: number;
  totalDaysGranted: number;
}

export interface ReferralRewardEntry {
  id: string;
  referrerUserId: string;
  referrerLabel: string;
  referredUserId: string;
  referredLabel: string;
  rewardType: string;
  level: number;
  daysGranted: number;
  trafficGbGranted: number;
  status: string;
  createdAt: string;
}

export interface ReferralMilestone {
  convertedCount: number;
  bonusDays: number;
}

export interface ReferralSettings {
  id: string;
  enabled: boolean;
  referredSignupBonusType: 'days' | 'traffic_gb';
  referredSignupBonusDays: number;
  referredSignupBonusTrafficGb: number;
  referrerSignupRewardEnabled: boolean;
  referrerSignupRewardType: 'days' | 'traffic_gb';
  referrerSignupRewardDays: number;
  referrerSignupRewardTrafficGb: number;
  referrerSignupTrafficMaxStackedGb: number;
  referrerSignupRewardTrafficFallbackDays: number;
  referrerSignupRewardMaxPer7d: number;
  conversionRewardMode: 'flat_days' | 'percent_of_purchase';
  conversionRewardFlatDays: number;
  conversionRewardPercent: number;
  conversionTrafficBonusEnabled: boolean;
  conversionTrafficBonusGb: number;
  conversionTrafficBonusMaxStackedGb: number;
  conversionTrafficBonusFallbackDays: number;
  level2RewardPercent: number;
  milestones: ReferralMilestone[];
  maxRewardedConversionsPer30d: number;
  maxBankedDays: number;
  updatedAt: string;
}

export function getReferralStats(): Promise<ReferralStats> {
  return apiFetch('/api/referrals/stats');
}

export function getTopReferrers(limit = 10): Promise<TopReferrerEntry[]> {
  return apiFetch(`/api/referrals/top?limit=${limit}`);
}

export function getReferralRewards(params: {
  page: number;
  pageSize: number;
}): Promise<Paginated<ReferralRewardEntry>> {
  const query = new URLSearchParams();
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  return apiFetch(`/api/referrals?${query.toString()}`);
}

export function getReferralSettings(): Promise<ReferralSettings> {
  return apiFetch('/api/referrals/settings');
}

export function updateReferralSettings(payload: Partial<ReferralSettings>): Promise<ReferralSettings> {
  return apiFetch('/api/referrals/settings', { method: 'PUT', body: JSON.stringify(payload) });
}

export interface ServerCostEntry {
  id: string;
  nodeUuid: string;
  nodeName: string | null;
  monthlyCostRub: number;
  nextPaymentDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerCostMonthlyPoint {
  /** YYYY-MM */
  month: string;
  revenueRub: number;
  costRub: number;
}

export interface ServerCostSummary {
  totalMonthlyCostRub: number;
  currentMonthRevenueRub: number;
  coveragePercent: number | null;
  monthlyHistory: ServerCostMonthlyPoint[];
}

export interface ServerCostUpsertPayload {
  monthlyCostRub: number;
  nextPaymentDate: string | null;
  note: string | null;
  nodeName: string | null;
}

export function getServerCosts(): Promise<ServerCostEntry[]> {
  return apiFetch('/api/servers/costs');
}

export function upsertServerCost(nodeUuid: string, payload: ServerCostUpsertPayload): Promise<ServerCostEntry> {
  return apiFetch(`/api/servers/costs/${nodeUuid}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export function deleteServerCost(nodeUuid: string): Promise<{ ok: true }> {
  return apiFetch(`/api/servers/costs/${nodeUuid}`, { method: 'DELETE' });
}

export function getServerCostSummary(months: 6 | 12 = 12): Promise<ServerCostSummary> {
  return apiFetch(`/api/servers/cost-summary?months=${months}`);
}
