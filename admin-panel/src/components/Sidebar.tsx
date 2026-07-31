import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  IconActivity,
  IconBell,
  IconChevronDown,
  IconCreditCard,
  IconFileText,
  IconGift,
  IconGrid,
  IconLogOut,
  IconServer,
  IconTrendingUp,
  IconUsers,
} from './icons';

interface NavLeaf {
  to: string;
  label: string;
  end?: boolean;
  badge?: 'new';
}

type NavEntry =
  | (NavLeaf & { Icon: typeof IconGrid })
  | { label: string; Icon: typeof IconGrid; children: NavLeaf[] };

const NAV_ITEMS: NavEntry[] = [
  { to: '/', label: 'Обзор', Icon: IconGrid, end: true },
  { to: '/revenue', label: 'Доход', Icon: IconTrendingUp },
  { to: '/payments', label: 'Платежи', Icon: IconCreditCard },
  { to: '/servers', label: 'Серверы', Icon: IconServer },
  { to: '/monitoring', label: 'Мониторинг', Icon: IconActivity, badge: 'new' },
  {
    label: 'Уведомления',
    Icon: IconBell,
    children: [
      { to: '/notifications', label: 'Журнал', end: true },
      { to: '/notifications/constructor', label: 'Конструктор', badge: 'new' },
    ],
  },
  { to: '/logs', label: 'Логи', Icon: IconFileText },
  { to: '/users', label: 'Пользователи', Icon: IconUsers },
  { to: '/referrals', label: 'Рефералы', Icon: IconGift, badge: 'new' },
];

function isChildActive(pathname: string, children: NavLeaf[]): boolean {
  return children.some((child) => (child.end ? pathname === child.to : pathname.startsWith(child.to)));
}

export function Sidebar({ onLogout }: { onLogout: () => void }) {
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of NAV_ITEMS) {
      if ('children' in item && isChildActive(location.pathname, item.children)) {
        initial.add(item.label);
      }
    }
    return initial;
  });

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">V</span>
        <span className="sidebar-brand-text">VPN Admin</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          if ('children' in item) {
            const { label, Icon, children } = item;
            const open = openGroups.has(label);
            const groupActive = isChildActive(location.pathname, children);
            return (
              <div key={label} className="sidebar-group">
                <button
                  type="button"
                  className={`sidebar-link sidebar-group-toggle${groupActive ? ' active' : ''}`}
                  onClick={() => toggleGroup(label)}
                >
                  <Icon />
                  <span>{label}</span>
                  <span className={`sidebar-chevron${open ? ' open' : ''}`}>
                    <IconChevronDown size={14} />
                  </span>
                </button>
                {open && (
                  <div className="sidebar-subnav">
                    {children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        end={child.end}
                        className={({ isActive }) => `sidebar-sublink${isActive ? ' active' : ''}`}
                      >
                        <span>{child.label}</span>
                        {child.badge === 'new' && <span className="badge-new">новое</span>}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          }

          const { to, label, Icon, end, badge } = item;
          return (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}>
              <Icon />
              <span>{label}</span>
              {badge === 'new' && <span className="badge-new">новое</span>}
            </NavLink>
          );
        })}
      </nav>

      <button type="button" className="sidebar-logout" onClick={onLogout}>
        <IconLogOut />
        <span>Выйти</span>
      </button>
    </aside>
  );
}
