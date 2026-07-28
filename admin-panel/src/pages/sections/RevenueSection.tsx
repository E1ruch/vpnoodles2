import type { AdminOverview, RevenueBreakdownEntry } from '../../api';
import { formatMoney } from '../../format';

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

export function RevenueSection({ data }: { data: AdminOverview }) {
  return (
    <section className="card">
      <h2>Доход по завершённым платежам</h2>
      <p className="hint section-hint">
        Валюты не суммируются между собой (например RUB и Telegram Stars) — показаны отдельно.
      </p>
      <div className="revenue-grid">
        <RevenuePeriod title="Сегодня" entries={data.revenue.today} />
        <RevenuePeriod title="7 дней" entries={data.revenue.last7Days} />
        <RevenuePeriod title="30 дней" entries={data.revenue.last30Days} />
        <RevenuePeriod title="Всё время" entries={data.revenue.allTime} />
      </div>
    </section>
  );
}
