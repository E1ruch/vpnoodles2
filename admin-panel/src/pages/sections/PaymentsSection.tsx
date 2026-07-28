import type { AdminOverview } from '../../api';

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function PaymentsSection({ data }: { data: AdminOverview }) {
  return (
    <section className="card">
      <h2>Последние платежи</h2>
      {data.recentPayments.length === 0 ? (
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
              {data.recentPayments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.userLabel}</td>
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
    </section>
  );
}
