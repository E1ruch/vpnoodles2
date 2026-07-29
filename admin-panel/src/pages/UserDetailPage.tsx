import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, getUser, type UserDetail } from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { IconClock, IconLayers, IconUsers } from '../components/icons';
import { formatAction } from '../labels';

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    setUser(null);
    setError(null);
    setNotFound(false);
    getUser(id)
      .then(setUser)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError('Не удалось загрузить пользователя.');
        }
      });
  }, [id]);

  return (
    <>
      <Link className="back-link" to="/users">
        ← К списку пользователей
      </Link>

      {error && <p className="error">{error}</p>}
      {notFound && <p className="error">Пользователь не найден.</p>}
      {!error && !notFound && !user && <p className="hint">Загрузка…</p>}

      {user && (
        <>
          <PageHeader title={user.firstName ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : `Пользователь ${user.telegramId}`} />

          <section className="stat-grid">
            <StatCard
              accent="violet"
              icon={<IconUsers />}
              label="Telegram"
              value={user.username ? `@${user.username}` : String(user.telegramId)}
              sub={user.isActive ? 'активен' : 'неактивен'}
            />
            <StatCard accent="cyan" icon={<IconLayers />} label="Подписок" value={user.subscriptions.length} />
            <StatCard
              accent="green"
              icon={<IconClock />}
              label="Зарегистрирован"
              value={new Date(user.createdAt).toLocaleDateString('ru-RU')}
              sub={user.hasUsedTrial ? 'trial использован' : 'trial не использован'}
            />
          </section>

          <section className="card">
            <h2>Подписки</h2>
            {user.subscriptions.length === 0 ? (
              <p className="hint">Подписок нет.</p>
            ) : (
              <div className="table-scroll">
                <table className="payments-table">
                  <thead>
                    <tr>
                      <th>Тариф</th>
                      <th>Статус</th>
                      <th>Начало</th>
                      <th>Окончание</th>
                      <th>Устройства</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.subscriptions.map((sub) => (
                      <tr key={sub.id}>
                        <td>{sub.planName}</td>
                        <td>
                          <StatusBadge status={sub.isActive ? 'completed' : sub.status} />
                        </td>
                        <td>{new Date(sub.startDate).toLocaleDateString('ru-RU')}</td>
                        <td>{new Date(sub.endDate).toLocaleDateString('ru-RU')}</td>
                        <td>
                          {sub.usedDevices} / {sub.deviceLimit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Платежи</h2>
            {user.payments.length === 0 ? (
              <p className="hint">Платежей нет.</p>
            ) : (
              <div className="table-scroll">
                <table className="payments-table">
                  <thead>
                    <tr>
                      <th>Тариф</th>
                      <th>Сумма</th>
                      <th>Провайдер</th>
                      <th>Статус</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.payments.map((payment) => (
                      <tr key={payment.id}>
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

          <section className="card">
            <h2>Последние действия</h2>
            {user.recentActions.length === 0 ? (
              <p className="hint">Действий не зафиксировано.</p>
            ) : (
              <div className="table-scroll">
                <table className="payments-table">
                  <thead>
                    <tr>
                      <th>Действие</th>
                      <th>Объект</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.recentActions.map((action) => (
                      <tr key={action.id}>
                        <td>{formatAction(action.action)}</td>
                        <td>{action.entityType ? `${action.entityType} · ${action.entityId?.slice(0, 8) ?? ''}` : '—'}</td>
                        <td>{new Date(action.createdAt).toLocaleString('ru-RU')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
