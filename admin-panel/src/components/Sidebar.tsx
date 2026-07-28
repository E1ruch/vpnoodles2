import { IconBell, IconCreditCard, IconGrid, IconLogOut, IconServer, IconTrendingUp } from './icons';

export type SectionId = 'overview' | 'revenue' | 'payments' | 'servers' | 'notifications';

const NAV_ITEMS: Array<{ id: SectionId; label: string; Icon: typeof IconGrid }> = [
  { id: 'overview', label: 'Обзор', Icon: IconGrid },
  { id: 'revenue', label: 'Доход', Icon: IconTrendingUp },
  { id: 'payments', label: 'Платежи', Icon: IconCreditCard },
  { id: 'servers', label: 'Серверы', Icon: IconServer },
  { id: 'notifications', label: 'Уведомления', Icon: IconBell },
];

export function Sidebar({
  active,
  onSelect,
  onLogout,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  onLogout: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">V</span>
        <span className="sidebar-brand-text">VPN Admin</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`sidebar-link${active === id ? ' active' : ''}`}
            onClick={() => onSelect(id)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <button type="button" className="sidebar-logout" onClick={onLogout}>
        <IconLogOut />
        <span>Выйти</span>
      </button>
    </aside>
  );
}
