import type { RevenueBreakdownEntry } from './api';

export function formatMoney(entry: RevenueBreakdownEntry): string {
  const label = entry.currency ?? entry.provider;
  return `${entry.total.toLocaleString('ru-RU')} ${label}`;
}

export function sumRevenue(entries: RevenueBreakdownEntry[]): string {
  if (entries.length === 0) return '—';
  return entries.map((entry) => formatMoney(entry)).join(' + ');
}
