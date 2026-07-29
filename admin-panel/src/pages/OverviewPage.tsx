import { useOutletContext } from 'react-router-dom';
import type { DashboardOutletContext } from './DashboardLayout';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { IconBell, IconClock, IconFileText, IconLayers, IconServer, IconUsers } from '../components/icons';
import { sumRevenue } from '../format';

export function OverviewPage() {
  const { overview, overviewError } = useOutletContext<DashboardOutletContext>();

  if (overviewError) {
    return (
      <>
        <PageHeader title="Обзор" />
        <p className="error">{overviewError}</p>
      </>
    );
  }

  if (!overview) {
    return (
      <>
        <PageHeader title="Обзор" />
        <p className="hint">Загрузка…</p>
      </>
    );
  }

  const onlineNodes = overview.nodes.filter((node) => node.isConnected).length;
  const deliveryRate =
    overview.notifications.total > 0
      ? `${Math.round((overview.notifications.delivered / overview.notifications.total) * 100)}%`
      : '—';

  return (
    <>
      <PageHeader title="Обзор" />

      <section className="stat-grid">
        <StatCard
          accent="violet"
          icon={<IconUsers />}
          label="Пользователи"
          value={overview.usersCount}
          sub={`${overview.activeUsersCount} активны`}
        />
        <StatCard
          accent="cyan"
          icon={<IconLayers />}
          label="Подписки"
          value={overview.subscriptionsCount}
          sub={`${overview.activeSubscriptionsCount} активны`}
        />
        <StatCard
          accent="green"
          icon={<IconClock />}
          label="Доход сегодня"
          value={sumRevenue(overview.revenue.today)}
        />
        <StatCard accent="amber" icon={<IconFileText />} label="Логов записано" value={overview.logsCount} />
      </section>

      <section className="stat-grid">
        <StatCard
          accent="cyan"
          icon={<IconServer />}
          label="Серверы онлайн"
          value={`${onlineNodes} / ${overview.nodes.length}`}
        />
        <StatCard accent="violet" icon={<IconBell />} label="Доставляемость уведомлений" value={deliveryRate} />
        <StatCard accent="green" label="Всего платежей" value={overview.paymentsCount} />
        <StatCard accent="rose" label="Доход всего" value={sumRevenue(overview.revenue.allTime)} />
      </section>
    </>
  );
}
