import { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { DashboardOutletContext } from './DashboardLayout';
import { getNotificationLogs, type NotificationLogEntry, type Paginated } from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Pagination } from '../components/Pagination';
import { IconBell, IconCheckCircle, IconXCircle } from '../components/icons';
import { NOTIFICATION_TYPE_LABELS, formatNotificationType } from '../labels';

const PAGE_SIZE = 20;

export function NotificationsPage() {
  const { overview, overviewError, refetchOverview } = useOutletContext<DashboardOutletContext>();

  const [page, setPage] = useState(0);
  const [type, setType] = useState('');
  const [data, setData] = useState<Paginated<NotificationLogEntry> | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadList = useCallback(() => {
    setListError(null);
    getNotificationLogs({ type: type || undefined, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch(() => setListError('Не удалось загрузить уведомления.'));
  }, [type, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleRefresh = () => {
    refetchOverview();
    loadList();
  };

  const { total, delivered, failed } = overview?.notifications ?? { total: 0, delivered: 0, failed: 0 };
  const deliveredPct = total > 0 ? Math.round((delivered / total) * 100) : 0;

  return (
    <>
      <PageHeader title="Уведомления">
        <select
          className="filter-select"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(0);
          }}
        >
          <option value="">Все типы</option>
          {Object.entries(NOTIFICATION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleRefresh}>
          Обновить
        </button>
      </PageHeader>

      {overviewError && <p className="error">{overviewError}</p>}
      {overview && (
        <section className="stat-grid">
          <StatCard accent="violet" icon={<IconBell />} label="Всего отправлено" value={total} />
          <StatCard accent="green" icon={<IconCheckCircle />} label="Доставлено" value={delivered} />
          <StatCard accent="rose" icon={<IconXCircle />} label="Не доставлено" value={failed} />
        </section>
      )}

      {overview && (
        <section className="card">
          <h2>Доставляемость</h2>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${deliveredPct}%` }} />
          </div>
          <p className="hint section-hint">
            {deliveredPct}% доставлено из {total}
          </p>
        </section>
      )}

      {listError && <p className="error">{listError}</p>}
      {!listError && !data && <p className="hint">Загрузка…</p>}

      {data && (
        <section className="card">
          <h2>Журнал уведомлений</h2>
          {data.items.length === 0 ? (
            <p className="hint">Уведомлений пока нет.</p>
          ) : (
            <div className="table-scroll">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Тип</th>
                    <th>Статус</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <Link className="user-link" to={`/users/${entry.userId}`}>
                          {entry.userLabel}
                        </Link>
                      </td>
                      <td>{formatNotificationType(entry.type)}</td>
                      <td>
                        <span className={`badge ${entry.delivered ? 'badge-completed' : 'badge-failed'}`}>
                          {entry.delivered ? 'доставлено' : 'ошибка'}
                        </span>
                      </td>
                      <td>{new Date(entry.createdAt).toLocaleString('ru-RU')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </section>
      )}
    </>
  );
}
