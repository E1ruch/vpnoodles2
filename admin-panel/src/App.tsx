import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { getMe } from './api';
import { LoginPage } from './pages/Login';
import { DashboardLayout } from './pages/DashboardLayout';
import { OverviewPage } from './pages/OverviewPage';
import { RevenuePage } from './pages/RevenuePage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ServersPage } from './pages/ServersPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { LogsPage } from './pages/LogsPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';

type AuthState = 'checking' | 'authenticated' | 'anonymous';

function App() {
  const [authState, setAuthState] = useState<AuthState>('checking');

  useEffect(() => {
    getMe()
      .then(() => setAuthState('authenticated'))
      .catch(() => setAuthState('anonymous'));
  }, []);

  if (authState === 'checking') {
    return (
      <div className="page">
        <p className="hint">Загрузка…</p>
      </div>
    );
  }

  if (authState === 'anonymous') {
    return <LoginPage onLoggedIn={() => setAuthState('authenticated')} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout onLoggedOut={() => setAuthState('anonymous')} />}>
          <Route index element={<OverviewPage />} />
          <Route path="revenue" element={<RevenuePage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="servers" element={<ServersPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
