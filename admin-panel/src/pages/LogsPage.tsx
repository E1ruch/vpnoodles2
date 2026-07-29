import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuditLogs, type AuditLogEntry, type Paginated } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { formatAction } from '../labels';

const PAGE_SIZE = 20;

function hasMetadata(metadata: Record<string, unknown> | null): boolean {
  return !!metadata && Object.keys(metadata).length > 0;
}

export function LogsPage() {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Paginated<AuditLogEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getAuditLogs({ page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch(() => setError('Не удалось загрузить логи.'));
  }, [page]);

  useEffect(() => {
    load();
    setExpandedId(null);
  }, [load]);

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

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
                    <th />
                    <th>Действие</th>
                    <th>Пользователь</th>
                    <th>Объект</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log) => {
                    const expandable = hasMetadata(log.metadata);
                    const expanded = expandedId === log.id;
                    return (
                      <Fragment key={log.id}>
                        <tr
                          className={expandable ? 'log-row-expandable' : ''}
                          onClick={() => expandable && toggleExpanded(log.id)}
                        >
                          <td className="log-row-toggle">
                            {expandable && <span className={`log-chevron${expanded ? ' open' : ''}`}>▸</span>}
                          </td>
                          <td>{formatAction(log.action)}</td>
                          <td>
                            <Link className="user-link" to={`/users/${log.userId}`} onClick={(e) => e.stopPropagation()}>
                              {log.userLabel}
                            </Link>
                          </td>
                          <td>{log.entityType ? `${log.entityType} · ${log.entityId?.slice(0, 8) ?? ''}` : '—'}</td>
                          <td>{new Date(log.createdAt).toLocaleString('ru-RU')}</td>
                        </tr>
                        {expanded && (
                          <tr className="log-row-meta">
                            <td colSpan={5}>
                              <pre className="log-metadata">{JSON.stringify(log.metadata, null, 2)}</pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
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
