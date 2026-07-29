import { useOutletContext } from 'react-router-dom';
import type { DashboardOutletContext } from './DashboardLayout';
import type { AdminOverview } from '../api';
import { PageHeader } from '../components/PageHeader';

function nodeStatusLabel(node: AdminOverview['nodes'][number]): string {
  if (node.isDisabled) return 'отключён';
  if (node.isConnecting) return 'подключается';
  if (node.isConnected) return 'онлайн';
  return 'офлайн';
}

function nodeStatusClass(node: AdminOverview['nodes'][number]): string {
  if (node.isConnected) return 'online';
  if (node.isDisabled) return 'disabled';
  return 'offline';
}

export function ServersPage() {
  const { overview, overviewError, refetchOverview } = useOutletContext<DashboardOutletContext>();

  return (
    <>
      <PageHeader title="Серверы">
        <button type="button" onClick={refetchOverview}>
          Обновить
        </button>
      </PageHeader>

      {overviewError && <p className="error">{overviewError}</p>}
      {!overviewError && !overview && <p className="hint">Загрузка…</p>}

      {overview && (
        <section className="card">
          <h2>Серверы Remnawave</h2>
          {overview.nodes.length === 0 ? (
            <p className="hint">Серверов пока нет.</p>
          ) : (
            <div className="node-grid">
              {overview.nodes.map((node) => (
                <div key={node.name} className="node-card">
                  <div className="node-card-header">
                    <span className={`node-dot ${nodeStatusClass(node)}`} />
                    <span className="node-name">{node.name}</span>
                  </div>
                  <span className={`badge badge-node-${nodeStatusClass(node)}`}>{nodeStatusLabel(node)}</span>
                  <p className="node-meta">{node.usersOnline} пользователей онлайн</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
