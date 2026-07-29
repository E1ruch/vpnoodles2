import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuditLogs, type AuditLogEntry, type Paginated } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { formatAction } from '../labels';

const PAGE_SIZE = 20;

export function LogsPage() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getAuditLogs({ page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch(() => setError('Не удалось загрузить логи.'));
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="Логи">
        <button type="button" onClick={load}>
          Обновить
        </button>
      </PageHeader>

      {error && <p className="error">{error}</p>}
      {!error && !data && <p className="hint">Загрузка…</p>}

      {data && (
        <section className="card">
          {data.items.length === 0 ? (
            <p className="hint">Логов пока нет.</p>
          ) : (
            <div className="table-scroll">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>Действие</th>
                    <th>Пользователь</th>
                    <th>Объект</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log) => (
                    <tr key={log.id}>
                      <td>{formatAction(log.action)}</td>
                      <td>
                        <Link className="user-link" to={`/users/${log.userId}`}>
                          {log.userLabel}
                        </Link>
                      </td>
                      <td>{log.entityType ? `${log.entityType} · ${log.entityId?.slice(0, 8) ?? ''}` : '—'}</td>
                      <td>{new Date(log.createdAt).toLocaleString('ru-RU')}</td>
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
