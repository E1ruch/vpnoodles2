import { useEffect, useState } from 'react';
import { getOverview, logout, type AdminOverview } from '../api';
import { Sidebar, type SectionId } from '../components/Sidebar';
import { OverviewSection } from './sections/OverviewSection';
import { RevenueSection } from './sections/RevenueSection';
import { PaymentsSection } from './sections/PaymentsSection';
import { ServersSection } from './sections/ServersSection';
import { NotificationsSection } from './sections/NotificationsSection';

const SECTION_TITLES: Record<SectionId, string> = {
  overview: 'Обзор',
  revenue: 'Доход',
  payments: 'Платежи',
  servers: 'Серверы',
  notifications: 'Уведомления',
};

export function Dashboard({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionId>('overview');

  useEffect(() => {
    getOverview()
      .then(setData)
      .catch(() => setError('Не удалось загрузить обзор.'));
  }, []);

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    onLoggedOut();
  };

  return (
    <div className="dashboard">
      <Sidebar active={active} onSelect={setActive} onLogout={handleLogout} />
      <main className="dashboard-content">
        <header className="content-header">
          <h1>{SECTION_TITLES[active]}</h1>
        </header>

        {error && <p className="error">{error}</p>}
        {!error && !data && <p className="hint">Загрузка…</p>}

        {data && active === 'overview' && <OverviewSection data={data} />}
        {data && active === 'revenue' && <RevenueSection data={data} />}
        {data && active === 'payments' && <PaymentsSection data={data} />}
        {data && active === 'servers' && <ServersSection data={data} />}
        {data && active === 'notifications' && <NotificationsSection data={data} />}
      </main>
    </div>
  );
}
