import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { DashboardOutletContext } from './DashboardLayout';
import type { AdminOverview, ServerCostEntry, ServerCostSummary } from '../api';
import { deleteServerCost, getServerCostSummary, getServerCosts, upsertServerCost } from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { ServerCostChart } from '../components/ServerCostChart';

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

function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU')} ₽`;
}

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

function coverageAccent(coveragePercent: number | null): 'green' | 'amber' | 'rose' | 'violet' {
  if (coveragePercent === null) return 'violet';
  if (coveragePercent >= 100) return 'green';
  if (coveragePercent >= 70) return 'amber';
  return 'rose';
}

function ServerCostEditor({
  nodeUuid,
  nodeName,
  entry,
  onSaved,
}: {
  nodeUuid: string;
  nodeName: string;
  entry: ServerCostEntry | null;
  onSaved: (entry: ServerCostEntry) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [monthlyCostRub, setMonthlyCostRub] = useState(entry?.monthlyCostRub ?? 0);
  const [nextPaymentDate, setNextPaymentDate] = useState(toDateInputValue(entry?.nextPaymentDate ?? null));
  const [note, setNote] = useState(entry?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setMonthlyCostRub(entry?.monthlyCostRub ?? 0);
    setNextPaymentDate(toDateInputValue(entry?.nextPaymentDate ?? null));
    setNote(entry?.note ?? '');
  }, [entry, editing]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertServerCost(nodeUuid, {
        monthlyCostRub,
        nextPaymentDate: nextPaymentDate ? new Date(nextPaymentDate).toISOString() : null,
        note: note.trim() ? note.trim() : null,
        nodeName,
      });
      onSaved(saved);
      setEditing(false);
    } catch {
      setError('Не удалось сохранить.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="server-cost-view">
        {entry ? (
          <>
            <p className="node-meta">{formatRub(entry.monthlyCostRub)} / мес</p>
            {entry.nextPaymentDate && (
              <p className="node-meta">След. платёж: {formatDateShort(entry.nextPaymentDate)}</p>
            )}
            {entry.note && <p className="node-meta">{entry.note}</p>}
          </>
        ) : (
          <p className="hint">Стоимость не указана</p>
        )}
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          {entry ? 'Изменить' : 'Указать стоимость'}
        </button>
      </div>
    );
  }

  return (
    <div className="server-cost-form">
      {error && <p className="error">{error}</p>}
      <label>
        Стоимость, ₽/мес
        <input
          type="number"
          min={0}
          step={1}
          value={monthlyCostRub}
          onChange={(e) => setMonthlyCostRub(Number(e.target.value))}
        />
      </label>
      <label>
        След. платёж
        <input type="date" value={nextPaymentDate} onChange={(e) => setNextPaymentDate(e.target.value)} />
      </label>
      <label>
        Заметка
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      <div className="server-cost-actions">
        <button type="button" disabled={saving} onClick={handleSave}>
          {saving ? 'Сохраняю…' : 'Сохранить'}
        </button>
        <button type="button" disabled={saving} onClick={() => setEditing(false)}>
          Отмена
        </button>
      </div>
    </div>
  );
}

export function ServersPage() {
  const { overview, overviewError, refetchOverview } = useOutletContext<DashboardOutletContext>();

  const [costs, setCosts] = useState<ServerCostEntry[] | null>(null);
  const [costsError, setCostsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ServerCostSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [range, setRange] = useState<6 | 12>(12);

  const loadCosts = useCallback(() => {
    setCostsError(null);
    getServerCosts()
      .then(setCosts)
      .catch(() => setCostsError('Не удалось загрузить расходы на сервера.'));
  }, []);

  const loadSummary = useCallback((months: 6 | 12) => {
    setSummaryLoading(true);
    setSummaryError(null);
    getServerCostSummary(months)
      .then(setSummary)
      .catch(() => setSummaryError('Не удалось загрузить сводку по расходам.'))
      .finally(() => setSummaryLoading(false));
  }, []);

  useEffect(() => {
    loadCosts();
  }, [loadCosts]);

  useEffect(() => {
    loadSummary(range);
  }, [range, loadSummary]);

  const costsByUuid = useMemo(() => new Map((costs ?? []).map((c) => [c.nodeUuid, c])), [costs]);
  const nodeUuids = useMemo(() => new Set((overview?.nodes ?? []).map((n) => n.uuid)), [overview]);
  const orphanedCosts = useMemo(
    () => (costs ?? []).filter((c) => !nodeUuids.has(c.nodeUuid)),
    [costs, nodeUuids],
  );

  function handleSaved(saved: ServerCostEntry) {
    setCosts((prev) => {
      const others = (prev ?? []).filter((c) => c.nodeUuid !== saved.nodeUuid);
      return [...others, saved];
    });
    loadSummary(range);
  }

  async function handleDeleteOrphan(nodeUuid: string) {
    try {
      await deleteServerCost(nodeUuid);
      setCosts((prev) => (prev ?? []).filter((c) => c.nodeUuid !== nodeUuid));
      loadSummary(range);
    } catch {
      setCostsError('Не удалось удалить запись о расходах.');
    }
  }

  return (
    <>
      <PageHeader title="Серверы">
        <button type="button" onClick={refetchOverview}>
          Обновить
        </button>
      </PageHeader>

      {summary && (
        <div className="stat-grid">
          <StatCard label="Расходы на сервера" value={formatRub(summary.totalMonthlyCostRub)} sub="в месяц" accent="rose" />
          <StatCard
            label="Доход за текущий месяц"
            value={formatRub(summary.currentMonthRevenueRub)}
            sub="только RUB"
            accent="cyan"
          />
          <StatCard
            label="Покрытие расходов"
            value={summary.coveragePercent === null ? '—' : `${summary.coveragePercent}%`}
            sub={summary.coveragePercent === null ? 'расходы не указаны' : 'дохода к расходам'}
            accent={coverageAccent(summary.coveragePercent)}
          />
        </div>
      )}
      {summaryError && <p className="error">{summaryError}</p>}

      <ServerCostChart
        data={summary?.monthlyHistory ?? null}
        range={range}
        onRangeChange={setRange}
        loading={summaryLoading}
        error={summaryError}
      />

      {overviewError && <p className="error">{overviewError}</p>}
      {!overviewError && !overview && <p className="hint">Загрузка…</p>}
      {costsError && <p className="error">{costsError}</p>}

      {overview && (
        <section className="card">
          <h2>Серверы Remnawave</h2>
          {overview.nodes.length === 0 ? (
            <p className="hint">Серверов пока нет.</p>
          ) : (
            <div className="node-grid">
              {overview.nodes.map((node) => (
                <div key={node.uuid} className="node-card">
                  <div className="node-card-header">
                    <span className={`node-dot ${nodeStatusClass(node)}`} />
                    <span className="node-name">{node.name}</span>
                  </div>
                  <span className={`badge badge-node-${nodeStatusClass(node)}`}>{nodeStatusLabel(node)}</span>
                  <p className="node-meta">{node.usersOnline} пользователей онлайн</p>
                  <ServerCostEditor
                    nodeUuid={node.uuid}
                    nodeName={node.name}
                    entry={costsByUuid.get(node.uuid) ?? null}
                    onSaved={handleSaved}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {orphanedCosts.length > 0 && (
        <section className="card">
          <h2>Расходы без активного сервера</h2>
          <p className="hint">
            Эти записи о расходах привязаны к серверам, которых больше нет в Remnawave — возможно, сервер отключён,
            но платёж за него всё ещё идёт.
          </p>
          {orphanedCosts.map((c) => (
            <div key={c.nodeUuid} className="server-cost-orphan-row">
              <div>
                <p className="node-name">{c.nodeName ?? c.nodeUuid}</p>
                <p className="node-meta">
                  {formatRub(c.monthlyCostRub)} / мес
                  {c.nextPaymentDate ? ` · след. платёж: ${formatDateShort(c.nextPaymentDate)}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => handleDeleteOrphan(c.nodeUuid)}>
                Удалить
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
