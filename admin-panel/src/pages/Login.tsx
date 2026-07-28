import { useEffect, useRef, useState } from 'react';
import { getAuthConfig, loginWithPassword, loginWithTelegram } from '../api';

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

function DevLoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    loginWithPassword(username, password)
      .then(onLoggedIn)
      .catch(() => setError('Неверный логин или пароль.'))
      .finally(() => setSubmitting(false));
  };

  return (
    <form className="dev-login-form" onSubmit={handleSubmit}>
      <h3>Вход по паролю (только для разработки)</h3>
      <input
        type="text"
        placeholder="Логин"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        type="password"
        placeholder="Пароль"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" disabled={submitting}>
        Войти
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [devLoginEnabled, setDevLoginEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.onTelegramAuth = (user) => {
      loginWithTelegram(user)
        .then(onLoggedIn)
        .catch(() => {
          setError('Не удалось войти. Убедитесь, что ваш Telegram ID есть в ADMIN_TELEGRAM_IDS.');
        });
    };

    getAuthConfig()
      .then(({ botUsername, devLoginEnabled }) => {
        if (cancelled) return;
        setDevLoginEnabled(devLoginEnabled);
        if (!containerRef.current) return;
        const script = document.createElement('script');
        script.src = 'https://telegram.org/js/telegram-widget.js?22';
        script.async = true;
        script.setAttribute('data-telegram-login', botUsername);
        script.setAttribute('data-size', 'large');
        script.setAttribute('data-onauth', 'onTelegramAuth(user)');
        script.setAttribute('data-request-access', 'write');
        containerRef.current.appendChild(script);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось загрузить конфигурацию входа.');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      delete window.onTelegramAuth;
    };
  }, [onLoggedIn]);

  return (
    <div className="page centered">
      <div className="card login-card">
        <div className="login-brand-mark">V</div>
        <h1>VPN Admin</h1>
        <p className="hint">Войдите через Telegram, чтобы открыть панель.</p>
        {loading && <p className="hint">Загрузка виджета входа…</p>}
        {error && <p className="error">{error}</p>}
        <div ref={containerRef} className="telegram-widget" />
        {devLoginEnabled && <DevLoginForm onLoggedIn={onLoggedIn} />}
      </div>
    </div>
  );
}
