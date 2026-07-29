import { NavLink } from 'react-router-dom';
import {
  IconBell,
  IconCreditCard,
  IconFileText,
  IconGrid,
  IconLogOut,
  IconServer,
  IconTrendingUp,
  IconUsers,
} from './icons';

const NAV_ITEMS: Array<{ to: string; label: string; Icon: typeof IconGrid; end?: boolean }> = [
  { to: '/', label: 'Обзор', Icon: IconGrid, end: true },
  { to: '/revenue', label: 'Доход', Icon: IconTrendingUp },
  { to: '/payments', label: 'Платежи', Icon: IconCreditCard },
  { to: '/servers', label: 'Серверы', Icon: IconServer },
  { to: '/notifications', label: 'Уведомления', Icon: IconBell },
  { to: '/logs', label: 'Логи', Icon: IconFileText },
  { to: '/users', label: 'Пользователи', Icon: IconUsers },
];

export function Sidebar({ onLogout }: { onLogout: () => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">V</span>
        <span className="sidebar-brand-text">VPN Admin</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
            <Icon />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <button type="button" className="sidebar-logout" onClick={onLogout}>
        <IconLogOut />
        <span>Выйти</span>
      </button>
    </aside>
  );
}
