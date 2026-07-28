import type { AdminOverview } from '../../api';
import { StatCard } from '../../components/StatCard';
import { IconBell, IconClock, IconFileText, IconLayers, IconServer, IconUsers } from '../../components/icons';
import { sumRevenue } from '../../format';

export function OverviewSection({ data }: { data: AdminOverview }) {
  const onlineNodes = data.nodes.filter((n) => n.isConnected).length;
  const deliveryRate =
    data.notifications.total > 0
      ? `${Math.round((data.notifications.delivered / data.notifications.total) * 100)}%`
      : '—';

  return (
    <>
      <section className="stat-grid">
        <StatCard
          accent="violet"
          icon={<IconUsers />}
          label="Пользователи"
          value={data.usersCount}
          sub={`${data.activeUsersCount} активны`}
        />
        <StatCard
          accent="cyan"
          icon={<IconLayers />}
          label="Подписки"
          value={data.subscriptionsCount}
          sub={`${data.activeSubscriptionsCount} активны`}
        />
        <StatCard accent="green" icon={<IconClock />} label="Доход сегодня" value={sumRevenue(data.revenue.today)} />
        <StatCard accent="amber" icon={<IconFileText />} label="Логов записано" value={data.logsCount} />
      </section>

      <section className="stat-grid">
        <StatCard
          accent="cyan"
          icon={<IconServer />}
          label="Серверы онлайн"
          value={`${onlineNodes} / ${data.nodes.length}`}
        />
        <StatCard accent="violet" icon={<IconBell />} label="Доставляемость уведомлений" value={deliveryRate} />
        <StatCard accent="green" label="Всего платежей" value={data.paymentsCount} />
        <StatCard accent="rose" label="Доход всего" value={sumRevenue(data.revenue.allTime)} />
      </section>
    </>
  );
}
