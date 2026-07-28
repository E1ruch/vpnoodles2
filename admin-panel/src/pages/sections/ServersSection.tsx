import type { AdminOverview } from '../../api';

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

export function ServersSection({ data }: { data: AdminOverview }) {
  return (
    <section className="card">
      <h2>Серверы Remnawave</h2>
      {data.nodes.length === 0 ? (
        <p className="hint">Серверов пока нет.</p>
      ) : (
        <div className="node-grid">
          {data.nodes.map((node) => (
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
  );
}
