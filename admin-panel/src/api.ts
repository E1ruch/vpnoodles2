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
  subscriptions: Array<{
    id: string;
    planName: string;
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
  createdAt: string;
}

export interface SendCustomNotificationPayload {
  audience: 'user' | 'all';
  userId?: string;
  text: string;
  button?: { label: string; url: string } | null;
}

export interface SendCustomNotificationResult {
  audience: 'user' | 'all';
  recipients: number;
  sent: number;
  failed: number;
  /** true только для audience === 'all' — рассылка продолжается в фоне, итог — в /logs. */
  queued: boolean;
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
