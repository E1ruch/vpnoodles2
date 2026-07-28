import { useEffect, useState } from 'react';
import { getMe } from './api';
import { LoginPage } from './pages/Login';
import { Dashboard } from './pages/Dashboard';

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

  return <Dashboard onLoggedOut={() => setAuthState('anonymous')} />;
}

export default App;
