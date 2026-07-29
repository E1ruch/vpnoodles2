import { useOutletContext } from 'react-router-dom';
import type { DashboardOutletContext } from './DashboardLayout';
import type { RevenueBreakdownEntry } from '../api';
import { PageHeader } from '../components/PageHeader';
import { formatMoney } from '../format';

function RevenuePeriod({ title, entries }: { title: string; entries: RevenueBreakdownEntry[] }) {
  return (
    <div className="revenue-period">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="hint">—</p>
      ) : (
        <ul>
          {entries.map((entry, i) => (
            <li key={`${entry.provider}-${entry.currency}-${i}`}>
              <span className="revenue-amount">{formatMoney(entry)}</span>
              <span className="revenue-meta">
                {entry.provider} · {entry.count} платежей
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RevenuePage() {
  const { overview, overviewError } = useOutletContext<DashboardOutletContext>();

  if (overviewError) {
    return (
      <>
        <PageHeader title="Доход" />
        <p className="error">{overviewError}</p>
      </>
    );
  }

  if (!overview) {
    return (
      <>
        <PageHeader title="Доход" />
        <p className="hint">Загрузка…</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Доход" />
      <section className="card">
        <h2>Доход по завершённым платежам</h2>
        <p className="hint section-hint">
          Валюты не суммируются между собой (например RUB и Telegram Stars) — показаны отдельно.
        </p>
        <div className="revenue-grid">
          <RevenuePeriod title="Сегодня" entries={overview.revenue.today} />
          <RevenuePeriod title="7 дней" entries={overview.revenue.last7Days} />
          <RevenuePeriod title="30 дней" entries={overview.revenue.last30Days} />
          <RevenuePeriod title="Всё время" entries={overview.revenue.allTime} />
        </div>
      </section>
    </>
  );
}
