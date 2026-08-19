import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiError, PlanEntry, PlanInput, PlanType } from '../api';
import { createPlan, deletePlan, getPlans, updatePlan } from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { IconLayers, IconUsers } from '../components/icons';

const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  trial: 'Пробный',
  paid: 'Платный',
};

interface PlanFormValues {
  name: string;
  type: PlanType;
  durationDays: string;
  deviceLimit: string;
  priceStars: string;
  priceRub: string;
  isActive: boolean;
  sortOrder: string;
  remnawaveTag: string;
  description: string;
}

const EMPTY_FORM: PlanFormValues = {
  name: '',
  type: 'paid',
  durationDays: '30',
  deviceLimit: '3',
  priceStars: '0',
  priceRub: '0',
  isActive: true,
  sortOrder: '0',
  remnawaveTag: '',
  description: '',
};

function toFormValues(plan: PlanEntry): PlanFormValues {
  return {
    name: plan.name,
    type: plan.type,
    durationDays: String(plan.durationDays),
    deviceLimit: String(plan.deviceLimit),
    priceStars: String(plan.priceStars),
    priceRub: String(plan.priceRub),
    isActive: plan.isActive,
    sortOrder: String(plan.sortOrder),
    remnawaveTag: plan.remnawaveTag ?? '',
    description: plan.description ?? '',
  };
}

function parseFormValues(values: PlanFormValues): PlanInput | { error: string } {
  if (!values.name.trim()) {
    return { error: 'Название обязательно.' };
  }
  const durationDays = Number.parseInt(values.durationDays, 10);
  if (!Number.isInteger(durationDays) || durationDays <= 0) {
    return { error: 'Срок действия должен быть положительным числом дней.' };
  }
  const deviceLimit = Number.parseInt(values.deviceLimit, 10);
  if (!Number.isInteger(deviceLimit) || deviceLimit <= 0) {
    return { error: 'Лимит устройств должен быть положительным числом.' };
  }
  const priceStars = Number.parseInt(values.priceStars, 10);
  if (!Number.isInteger(priceStars) || priceStars < 0) {
    return { error: 'Цена в Stars не может быть отрицательной.' };
  }
  const priceRub = Number.parseInt(values.priceRub, 10);
  if (!Number.isInteger(priceRub) || priceRub < 0) {
    return { error: 'Цена в рублях не может быть отрицательной.' };
  }
  const sortOrder = Number.parseInt(values.sortOrder, 10);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { error: 'Порядок сортировки не может быть отрицательным.' };
  }

  return {
    name: values.name.trim(),
    type: values.type,
    durationDays,
    deviceLimit,
    priceStars,
    priceRub,
    isActive: values.isActive,
    sortOrder,
    remnawaveTag: values.remnawaveTag.trim() ? values.remnawaveTag.trim() : null,
    description: values.description.trim() ? values.description.trim() : null,
  };
}

function PlanForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: PlanFormValues;
  submitLabel: string;
  onSubmit: (input: PlanInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    const parsed = parseFormValues(values);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(parsed);
    } catch {
      setError('Не удалось сохранить план.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="plan-form">
      {error && <p className="error">{error}</p>}
      <label>
        Название
        <input type="text" value={values.name} onChange={(e) => set('name', e.target.value)} maxLength={255} />
      </label>
      <div className="plan-form-row">
        <label>
          Тип
          <select value={values.type} onChange={(e) => set('type', e.target.value as PlanType)}>
            <option value="trial">Пробный</option>
            <option value="paid">Платный</option>
          </select>
        </label>
        <label>
          Срок, дней
          <input
            type="number"
            min={1}
            step={1}
            value={values.durationDays}
            onChange={(e) => set('durationDays', e.target.value)}
          />
        </label>
        <label>
          Устройств
          <input
            type="number"
            min={1}
            step={1}
            value={values.deviceLimit}
            onChange={(e) => set('deviceLimit', e.target.value)}
          />
        </label>
      </div>
      <div className="plan-form-row">
        <label>
          Цена, ⭐
          <input
            type="number"
            min={0}
            step={1}
            value={values.priceStars}
            onChange={(e) => set('priceStars', e.target.value)}
          />
        </label>
        <label>
          Цена, ₽
          <input
            type="number"
            min={0}
            step={1}
            value={values.priceRub}
            onChange={(e) => set('priceRub', e.target.value)}
          />
        </label>
        <label>
          Сортировка
          <input
            type="number"
            min={0}
            step={1}
            value={values.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
          />
        </label>
      </div>
      <label className="plan-form-checkbox">
        <input type="checkbox" checked={values.isActive} onChange={(e) => set('isActive', e.target.checked)} />
        Активен (виден пользователям)
      </label>
      <label>
        Тег в Remnawave
        <input
          type="text"
          value={values.remnawaveTag}
          onChange={(e) => set('remnawaveTag', e.target.value)}
          maxLength={100}
        />
      </label>
      <label>
        Описание
        <textarea value={values.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} />
      </label>
      <div className="plan-form-actions">
        <button type="button" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Сохраняю…' : submitLabel}
        </button>
        <button type="button" disabled={saving} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  onSaved,
  onDeleted,
}: {
  plan: PlanEntry;
  onSaved: (plan: PlanEntry) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleSave(input: PlanInput) {
    const saved = await updatePlan(plan.id, input);
    // updatePlan не пересчитывает activeSubscriptionsCount — редактирование полей плана
    // не меняет число подписок на него, поэтому переносим текущее значение как есть.
    onSaved({ ...saved, activeSubscriptionsCount: plan.activeSubscriptionsCount });
    setEditing(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePlan(plan.id);
      onDeleted(plan.id);
    } catch (err) {
      const apiErr = err as ApiError;
      setDeleteError(
        apiErr?.status === 409
          ? 'План используется в существующих подписках или платежах — деактивируйте его вместо удаления.'
          : 'Не удалось удалить план.',
      );
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <div className="plan-card">
        <div className="plan-card-header">
          <span className="plan-price">{plan.name}</span>
        </div>
        <PlanForm
          initial={toFormValues(plan)}
          submitLabel="Сохранить"
          onSubmit={handleSave}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className={`plan-card${plan.isActive ? '' : ' inactive'}`}>
      <div className="plan-card-header">
        <div>
          <span className="plan-price">
            {plan.type === 'paid' ? `${plan.priceRub.toLocaleString('ru-RU')} ₽` : 'Бесплатно'}
          </span>
          {plan.type === 'paid' && plan.priceStars > 0 && <span className="node-meta"> · {plan.priceStars} ⭐</span>}
        </div>
        <div className="plan-card-badges">
          <span className={`badge badge-plan-${plan.type}`}>{PLAN_TYPE_LABEL[plan.type]}</span>
          <span className={`badge ${plan.isActive ? 'badge-completed' : 'badge-node-disabled'}`}>
            {plan.isActive ? 'активен' : 'скрыт'}
          </span>
        </div>
      </div>

      <span className="node-name">{plan.name}</span>
      <p className="node-meta">
        {plan.durationDays} дней · до {plan.deviceLimit} устройств
      </p>
      {plan.remnawaveTag && <p className="node-meta">Тег: {plan.remnawaveTag}</p>}
      {plan.description && <p className="node-meta">{plan.description}</p>}
      <p className="node-meta">Сортировка: {plan.sortOrder}</p>

      <div className="plan-subscribers">
        <IconUsers size={14} />
        <span>
          Активных подписок: <strong>{plan.activeSubscriptionsCount}</strong>
        </span>
      </div>

      {deleteError && <p className="error">{deleteError}</p>}

      {!confirmingDelete ? (
        <div className="plan-card-actions">
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Изменить
          </button>
          <button type="button" className="link-button" onClick={() => setConfirmingDelete(true)}>
            Удалить
          </button>
        </div>
      ) : (
        <div className="confirm-box confirm-box-all">
          <p>
            Точно удалить план <strong>{plan.name}</strong>?
          </p>
          <div className="confirm-box-actions">
            <button type="button" disabled={deleting} onClick={() => setConfirmingDelete(false)}>
              Отмена
            </button>
            <button type="submit" disabled={deleting} onClick={handleDelete}>
              {deleting ? 'Удаляю…' : 'Да, удалить'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PlansPage() {
  const [plans, setPlans] = useState<PlanEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getPlans()
      .then(setPlans)
      .catch(() => setError('Не удалось загрузить тарифные планы.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!plans) return null;
    return {
      total: plans.length,
      active: plans.filter((p) => p.isActive).length,
      subscribers: plans.reduce((sum, p) => sum + p.activeSubscriptionsCount, 0),
    };
  }, [plans]);

  const trialPlans = useMemo(() => (plans ?? []).filter((p) => p.type === 'trial'), [plans]);
  const paidPlans = useMemo(() => (plans ?? []).filter((p) => p.type === 'paid'), [plans]);

  function handleCreated(plan: PlanEntry) {
    setPlans((prev) => [...(prev ?? []), plan]);
    setCreating(false);
  }

  function handleSaved(saved: PlanEntry) {
    setPlans((prev) => (prev ?? []).map((p) => (p.id === saved.id ? saved : p)));
  }

  function handleDeleted(id: string) {
    setPlans((prev) => (prev ?? []).filter((p) => p.id !== id));
  }

  return (
    <>
      <PageHeader title="Тарифные планы">
        <button type="button" onClick={load}>
          Обновить
        </button>
        <button type="submit" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Отмена' : '+ Новый план'}
        </button>
      </PageHeader>

      {stats && (
        <div className="stat-grid">
          <StatCard icon={<IconLayers />} label="Всего планов" value={stats.total} accent="violet" />
          <StatCard icon={<IconLayers />} label="Активных планов" value={stats.active} sub="видны пользователям" accent="green" />
          <StatCard
            icon={<IconUsers />}
            label="Подписчиков"
            value={stats.subscribers}
            sub="активных подписок по всем планам"
            accent="cyan"
          />
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!error && !plans && <p className="hint">Загрузка…</p>}

      {creating && (
        <section className="card">
          <h2>Новый план</h2>
          <PlanForm
            initial={EMPTY_FORM}
            submitLabel="Создать"
            onSubmit={async (input) => {
              const created = await createPlan(input);
              handleCreated({ ...created, activeSubscriptionsCount: 0 });
            }}
            onCancel={() => setCreating(false)}
          />
        </section>
      )}

      {plans && (
        <>
          <section className="card plan-group">
            <h2>Пробные</h2>
            {trialPlans.length === 0 ? (
              <p className="hint">Пробных планов нет.</p>
            ) : (
              <div className="plan-grid">
                {trialPlans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))}
              </div>
            )}
          </section>

          <section className="card plan-group">
            <h2>Платные</h2>
            {paidPlans.length === 0 ? (
              <p className="hint">Платных планов нет.</p>
            ) : (
              <div className="plan-grid">
                {paidPlans.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} onSaved={handleSaved} onDeleted={handleDeleted} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
