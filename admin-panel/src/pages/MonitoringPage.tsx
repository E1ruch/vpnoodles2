import { useCallback, useEffect, useRef, useState } from 'react';
import { getSystemHealth, type SystemHealthResult } from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { IconActivity } from '../components/icons';

const REFRESH_INTERVAL_MS = 15000;

const STATUS_LABEL: Record<SystemHealthResult['status'], string> = {
  ok: 'Все системы работают',
  warning: 'Есть предупреждения',
  critical: 'Критическая ошибка',
};

function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} ГБ`;
  return `${(bytes / 1024 ** 2).toFixed(0)} МБ`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}

function percentAccent(percent: number, warnAt: number): 'green' | 'amber' | 'rose' {
  if (percent >= warnAt) return 'rose';
  if (percent >= warnAt - 15) return 'amber';
  return 'green';
}

export function MonitoringPage() {
  const [health, setHealth] = useState<SystemHealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    getSystemHealth()
      .then((res) => {
        setHealth(res);
        setError(null);
        setLastFetchedAt(new Date());
      })
      .catch(() => setError('Не удалось загрузить состояние системы.'))
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <>
      <PageHeader title="Мониторинг">
        <button type="button" onClick={load}>
          Обновить
        </button>
      </PageHeader>

      {error && !health && <p className="error">{error}</p>}
      {!error && !health && <p className="hint">Загрузка…</p>}

      {health && (
        <>
          <section className={`health-banner health-banner-${health.status}`}>
            <IconActivity size={22} />
            <div>
              <div className="health-banner-title">{STATUS_LABEL[health.status]}</div>
              <div className="health-banner-sub">
                Обновлено: {lastFetchedAt?.toLocaleTimeString('ru-RU') ?? '—'}
                {error && ' · последнее обновление не удалось, показаны старые данные'}
              </div>
            </div>
          </section>

          <section className="stat-grid">
            <StatCard
              accent={percentAccent(health.vps.cpuPercent, 95)}
              label="CPU"
              value={`${health.vps.cpuPercent.toFixed(0)}%`}
              sub={`load avg: ${health.vps.loadAverage.map((v) => v.toFixed(2)).join(' · ')}`}
            />
            <StatCard
              accent={percentAccent((health.vps.memory.usedBytes / health.vps.memory.totalBytes) * 100, 90)}
              label="RAM"
              value={formatBytes(health.vps.memory.usedBytes)}
              sub={`из ${formatBytes(health.vps.memory.totalBytes)}`}
            />
            <StatCard
              accent={percentAccent((health.vps.disk.usedBytes / health.vps.disk.totalBytes) * 100, 90)}
              label="Диск"
              value={formatBytes(health.vps.disk.usedBytes)}
              sub={`из ${formatBytes(health.vps.disk.totalBytes)}`}
            />
            <StatCard accent="violet" label="Uptime сервера" value={formatUptime(health.vps.uptimeSeconds)} />
          </section>

          <section className="card">
            <h2>Компоненты приложения</h2>
            <div className="health-components">
              {health.components.map((component) => (
                <div key={component.name} className={`health-component-chip health-component-${component.status}`}>
                  <span className="health-component-dot" />
                  <span className="health-component-label">{component.label}</span>
                  <span className="health-component-meta">
                    {component.status === 'ok'
                      ? component.latencyMs !== null
                        ? `${component.latencyMs} мс`
                        : 'OK'
                      : (component.message ?? 'недоступен')}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Предупреждения</h2>
            {health.warnings.length === 0 ? (
              <p className="hint">Предупреждений нет.</p>
            ) : (
              <ul className="health-warnings">
                {health.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Последние ошибки</h2>
            {health.recentErrors.length === 0 ? (
              <p className="hint">Ошибок не зафиксировано.</p>
            ) : (
              <ul className="health-errors">
                {health.recentErrors.map((err, i) => (
                  <li key={i}>
                    <span className="health-error-time">{new Date(err.time).toLocaleString('ru-RU')}</span>
                    <span className="health-error-message">{err.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
