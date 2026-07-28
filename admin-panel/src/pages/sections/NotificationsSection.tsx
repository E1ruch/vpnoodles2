import type { AdminOverview } from '../../api';
import { StatCard } from '../../components/StatCard';
import { IconBell, IconCheckCircle, IconXCircle } from '../../components/icons';

export function NotificationsSection({ data }: { data: AdminOverview }) {
  const { total, delivered, failed, byType } = data.notifications;
  const deliveredPct = total > 0 ? Math.round((delivered / total) * 100) : 0;

  return (
    <>
      <section className="stat-grid">
        <StatCard accent="violet" icon={<IconBell />} label="Всего отправлено" value={total} />
        <StatCard accent="green" icon={<IconCheckCircle />} label="Доставлено" value={delivered} />
        <StatCard accent="rose" icon={<IconXCircle />} label="Не доставлено" value={failed} />
      </section>

      <section className="card">
        <h2>Доставляемость</h2>
        <div className="progress-bar">
          <div className="progress-bar-fill" style={{ width: `${deliveredPct}%` }} />
        </div>
        <p className="hint section-hint">{deliveredPct}% доставлено из {total}</p>
      </section>

      {byType.length > 0 && (
        <section className="card">
          <h2>По типам уведомлений</h2>
          <div className="table-scroll">
            <table className="payments-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Всего</th>
                  <th>Доставлено</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((row) => (
                  <tr key={row.type}>
                    <td>{row.type}</td>
                    <td>{row.total}</td>
                    <td>{row.delivered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
