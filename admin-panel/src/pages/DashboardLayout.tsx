import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { getOverview, logout, type AdminOverview } from '../api';
import { Sidebar } from '../components/Sidebar';

export interface DashboardOutletContext {
  overview: AdminOverview | null;
  overviewError: string | null;
  refetchOverview: () => void;
}

export function DashboardLayout({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const refetchOverview = useCallback(() => {
    setOverviewError(null);
    getOverview()
      .then(setOverview)
      .catch(() => setOverviewError('Не удалось загрузить обзор.'));
  }, []);

  useEffect(() => {
    refetchOverview();
  }, [refetchOverview]);

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    onLoggedOut();
  };

  return (
    <div className="dashboard">
      <Sidebar onLogout={handleLogout} />
      <main className="dashboard-content">
        <Outlet context={{ overview, overviewError, refetchOverview } satisfies DashboardOutletContext} />
      </main>
    </div>
  );
}
