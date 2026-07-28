import type { ReactNode } from 'react';

export type StatAccent = 'violet' | 'cyan' | 'green' | 'amber' | 'rose';

export function StatCard({
  icon,
  label,
  value,
  sub,
  accent = 'violet',
}: {
  icon?: ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: StatAccent;
}) {
  return (
    <div className={`stat-card accent-${accent}`}>
      {icon && <div className="stat-icon">{icon}</div>}
      <div className="stat-body">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  );
}
