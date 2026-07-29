import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUsers, type Paginated, type UserListEntry } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Pagination } from '../components/Pagination';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const PAGE_SIZE = 20;

export function UsersPage() {
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Paginated<UserListEntry> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);

  const load = useCallback(() => {
    setError(null);
    getUsers({ search: debouncedSearch || undefined, page, pageSize: PAGE_SIZE })
      .then(setData)
      .catch(() => setError('Не удалось загрузить пользователей.'));
  }, [debouncedSearch, page]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader title="Пользователи">
        <input
          type="text"
          className="search-input"
          placeholder="Поиск по имени, юзернейму или telegram id"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="button" onClick={load}>
          Обновить
        </button>
      </PageHeader>

      {error && <p className="error">{error}</p>}
      {!error && !data && <p className="hint">Загрузка…</p>}

      {data && (
        <section className="card">
          {data.items.length === 0 ? (
            <p className="hint">Пользователей не найдено.</p>
          ) : (
            <div className="table-scroll">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>Имя</th>
                    <th>Юзернейм</th>
                    <th>Telegram ID</th>
                    <th>Статус</th>
                    <th>Регистрация</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <Link className="user-link" to={`/users/${user.id}`}>
                          {user.firstName ?? 'Без имени'}
                          {user.lastName ? ` ${user.lastName}` : ''}
                        </Link>
                      </td>
                      <td>{user.username ? `@${user.username}` : '—'}</td>
                      <td>{user.telegramId}</td>
                      <td>
                        <span className={`badge ${user.isActive ? 'badge-completed' : 'badge-failed'}`}>
                          {user.isActive ? 'активен' : 'неактивен'}
                        </span>
                      </td>
                      <td>{new Date(user.createdAt).toLocaleDateString('ru-RU')}</td>
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
