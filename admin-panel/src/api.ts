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

export interface AdminOverviewPayment {
  id: string;
  userLabel: string;
  planLabel: string;
  amount: number;
  currency: string | null;
  provider: string;
  status: string;
  createdAt: string;
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
  recentPayments: AdminOverviewPayment[];
  nodes: RemnawaveNodeSummary[];
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
