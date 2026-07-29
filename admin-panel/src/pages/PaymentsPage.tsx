import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPayments, type Paginated, type PaymentListEntry } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'Все статусы' },
  { value: 'completed', label: 'Completed' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function PaymentsPage() {
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<Paginated<PaymentListEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getPayments({ status: status || undefined, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch(() => setError('Не удалось загрузить платежи.'));
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="Платежи">
        <select
          className="filter-select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={load}>
          Обновить
        </button>
      </PageHeader>

      {error && <p className="error">{error}</p>}
      {!error && !data && <p className="hint">Загрузка…</p>}

      {data && (
        <section className="card">
          {data.items.length === 0 ? (
            <p className="hint">Платежей пока нет.</p>
          ) : (
            <div className="table-scroll">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Тариф</th>
                    <th>Сумма</th>
                    <th>Провайдер</th>
                    <th>Статус</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((payment) => (
                    <tr key={payment.id}>
                      <td>
                        <Link className="user-link" to={`/users/${payment.userId}`}>
                          {payment.userLabel}
                        </Link>
                      </td>
                      <td>{payment.planLabel}</td>
                      <td>
                        {payment.amount} {payment.currency ?? ''}
                      </td>
                      <td>{payment.provider}</td>
                      <td>
                        <StatusBadge status={payment.status} />
                      </td>
                      <td>{new Date(payment.createdAt).toLocaleString('ru-RU')}</td>
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
