import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  getReferralRewards,
  getReferralSettings,
  getReferralStats,
  getTopReferrers,
  updateReferralSettings,
  type Paginated,
  type ReferralRewardEntry,
  type ReferralSettings,
  type ReferralStats,
  type TopReferrerEntry,
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { Pagination } from '../components/Pagination';
import { IconCheckCircle, IconChevronDown, IconClock, IconGift, IconUsers } from '../components/icons';
import { formatReferralRewardType } from '../labels';

const PAGE_SIZE = 20;
const TOP_LIMIT = 10;

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        min={min}
        step={1}
        className="search-input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** Сворачиваемая группа полей настроек — заголовок и описание видны всегда, поля скрываются. */
function SettingsSection({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="settings-section">
      <button type="button" className="settings-section-header" onClick={() => setOpen((v) => !v)}>
        <div className="settings-section-heading">
          <h3>{title}</h3>
          <p className="hint">{description}</p>
        </div>
        <span className={`settings-section-chevron${open ? ' open' : ''}`}>
          <IconChevronDown size={16} />
        </span>
      </button>
      {open && <div className="settings-section-body">{children}</div>}
    </div>
  );
}

function formatRewardAmount(reward: { daysGranted: number; trafficGbGranted: number }): string {
  const parts: string[] = [];
  if (reward.daysGranted > 0) parts.push(`${reward.daysGranted} дн.`);
  if (reward.trafficGbGranted > 0) parts.push(`${reward.trafficGbGranted} ГБ/день`);
  return parts.length > 0 ? parts.join(' + ') : '—';
}

export function ReferralsPage() {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [topReferrers, setTopReferrers] = useState<TopReferrerEntry[] | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [rewards, setRewards] = useState<Paginated<ReferralRewardEntry> | null>(null);
  const [rewardsError, setRewardsError] = useState<string | null>(null);

  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    setStatsError(null);
    getReferralStats()
      .then(setStats)
      .catch(() => setStatsError('Не удалось загрузить статистику.'));
    setTopError(null);
    getTopReferrers(TOP_LIMIT)
      .then(setTopReferrers)
      .catch(() => setTopError('Не удалось загрузить топ рефереров.'));
  }, []);

  const loadRewards = useCallback(() => {
    setRewardsError(null);
    getReferralRewards({ page, pageSize: PAGE_SIZE })
      .then(setRewards)
      .catch(() => setRewardsError('Не удалось загрузить начисления.'));
  }, [page]);

  const loadSettings = useCallback(() => {
    setSettingsError(null);
    getReferralSettings()
      .then(setSettings)
      .catch(() => setSettingsError('Не удалось загрузить настройки.'));
  }, []);

  useEffect(loadOverview, [loadOverview]);
  useEffect(loadRewards, [loadRewards]);
  useEffect(loadSettings, [loadSettings]);

  function set<K extends keyof ReferralSettings>(key: K, value: ReferralSettings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateMilestone(index: number, patch: Partial<ReferralSettings['milestones'][number]>) {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, milestones: prev.milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)) };
    });
  }

  function addMilestone() {
    setSettings((prev) =>
      prev ? { ...prev, milestones: [...prev.milestones, { convertedCount: 0, bonusDays: 0 }] } : prev,
    );
  }

  function removeMilestone(index: number) {
    setSettings((prev) =>
      prev ? { ...prev, milestones: prev.milestones.filter((_, i) => i !== index) } : prev,
    );
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setSaveMessage(null);
    setSettingsError(null);
    try {
      const updated = await updateReferralSettings(settings);
      setSettings(updated);
      setSaveMessage('Настройки сохранены.');
    } catch {
      setSettingsError('Не удалось сохранить настройки.');
    } finally {
      setSaving(false);
    }
  }

  const conversionRate =
    stats && stats.totalReferred > 0 ? `${Math.round((stats.totalConverted / stats.totalReferred) * 100)}% конверсия` : undefined;

  return (
    <>
      <PageHeader title="Рефералы" />

      {statsError && <p className="error">{statsError}</p>}
      {!statsError && !stats && <p className="hint">Загрузка…</p>}
      {stats && (
        <section className="stat-grid">
          <StatCard accent="violet" icon={<IconUsers />} label="Всего приглашено" value={stats.totalReferred} />
          <StatCard
            accent="cyan"
            icon={<IconCheckCircle />}
            label="Оплатили подписку"
            value={stats.totalConverted}
            sub={conversionRate}
          />
          <StatCard accent="green" icon={<IconGift />} label="Начислено дней всего" value={stats.totalDaysGranted} />
          <StatCard accent="amber" icon={<IconClock />} label="Ожидают получения" value={`${stats.totalPendingDays} дн.`} />
        </section>
      )}

      <section className="card">
        <h2>Топ рефереров</h2>
        {topError && <p className="error">{topError}</p>}
        {!topError && !topReferrers && <p className="hint">Загрузка…</p>}
        {topReferrers &&
          (topReferrers.length === 0 ? (
            <p className="hint">Пока никто никого не пригласил.</p>
          ) : (
            <div className="table-scroll">
              <table className="payments-table">
                <thead>
                  <tr>
                    <th>Пользователь</th>
                    <th>Приглашено</th>
                    <th>Оплатили</th>
                    <th>Начислено дней</th>
                  </tr>
                </thead>
                <tbody>
                  {topReferrers.map((row) => (
                    <tr key={row.referrerUserId}>
                      <td>
                        <Link className="user-link" to={`/users/${row.referrerUserId}`}>
                          {row.userLabel}
                        </Link>
                      </td>
                      <td>{row.invitedCount}</td>
                      <td>{row.convertedCount}</td>
                      <td>{row.totalDaysGranted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </section>

      <section className="card">
        <h2>Последние начисления</h2>
        {rewardsError && <p className="error">{rewardsError}</p>}
        {!rewardsError && !rewards && <p className="hint">Загрузка…</p>}
        {rewards &&
          (rewards.items.length === 0 ? (
            <p className="hint">Начислений пока нет.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="payments-table">
                  <thead>
                    <tr>
                      <th>Тип</th>
                      <th>Реферер</th>
                      <th>Реферал</th>
                      <th>Начислено</th>
                      <th>Статус</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rewards.items.map((reward) => (
                      <tr key={reward.id}>
                        <td>{formatReferralRewardType(reward.rewardType)}</td>
                        <td>
                          <Link className="user-link" to={`/users/${reward.referrerUserId}`}>
                            {reward.referrerLabel}
                          </Link>
                        </td>
                        <td>
                          <Link className="user-link" to={`/users/${reward.referredUserId}`}>
                            {reward.referredLabel}
                          </Link>
                        </td>
                        <td>{formatRewardAmount(reward)}</td>
                        <td>
                          <StatusBadge status={reward.status} />
                        </td>
                        <td>{new Date(reward.createdAt).toLocaleString('ru-RU')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={rewards.page} pageSize={rewards.pageSize} total={rewards.total} onPageChange={setPage} />
            </>
          ))}
      </section>

      <section className="card">
        <h2>Настройки программы</h2>
        {settingsError && <p className="error">{settingsError}</p>}
        {!settingsError && !settings && <p className="hint">Загрузка…</p>}
        {settings && (
          <>
            <CheckboxField
              label="Реферальная программа включена"
              checked={settings.enabled}
              onChange={(v) => set('enabled', v)}
              hint="Общий выключатель: если что-то пошло не так, выключите здесь — атрибуция и начисления остановятся сразу, накопленные данные не потеряются."
            />

            <SettingsSection
              title="Бонус приглашённому другу"
              description="Что получает сам приглашённый друг сразу после активации бесплатного пробного периода по вашей ссылке."
            >
              <div className="field">
                <label>Валюта бонуса</label>
                <select
                  className="filter-select"
                  value={settings.referredSignupBonusType}
                  onChange={(e) => set('referredSignupBonusType', e.target.value as ReferralSettings['referredSignupBonusType'])}
                >
                  <option value="traffic_gb">Трафик (ГБ/день)</option>
                  <option value="days">Дни</option>
                </select>
              </div>
              <NumberField
                label="Дней (режим «Дни»)"
                value={settings.referredSignupBonusDays}
                onChange={(v) => set('referredSignupBonusDays', v)}
              />
              <NumberField
                label="ГБ/день (режим «Трафик»)"
                value={settings.referredSignupBonusTrafficGb}
                onChange={(v) => set('referredSignupBonusTrafficGb', v)}
              />
            </SettingsSection>

            <SettingsSection
              title="Бонус пригласившему за сигнап друга"
              description="Начисляется пригласившему, когда друг просто активирует бесплатный пробный период — без оплаты. Самый дешёвый шаг для накрутки, поэтому есть недельный лимит на начисления."
            >
              <CheckboxField
                label="Начислять бонус за сигнап"
                checked={settings.referrerSignupRewardEnabled}
                onChange={(v) => set('referrerSignupRewardEnabled', v)}
              />
              <div className="field">
                <label>Валюта бонуса</label>
                <select
                  className="filter-select"
                  value={settings.referrerSignupRewardType}
                  onChange={(e) => set('referrerSignupRewardType', e.target.value as ReferralSettings['referrerSignupRewardType'])}
                >
                  <option value="traffic_gb">Трафик (ГБ/день)</option>
                  <option value="days">Дни</option>
                </select>
              </div>
              <NumberField label="Дней (режим «Дни»)" value={settings.referrerSignupRewardDays} onChange={(v) => set('referrerSignupRewardDays', v)} />
              <NumberField
                label="ГБ/день за сигнап (режим «Трафик», стакается)"
                value={settings.referrerSignupRewardTrafficGb}
                onChange={(v) => set('referrerSignupRewardTrafficGb', v)}
              />
              <NumberField
                label="Потолок стека ГБ/день"
                value={settings.referrerSignupTrafficMaxStackedGb}
                onChange={(v) => set('referrerSignupTrafficMaxStackedGb', v)}
              />
              <NumberField
                label="Дней взамен, если реферер уже на безлимитном платном плане"
                value={settings.referrerSignupRewardTrafficFallbackDays}
                onChange={(v) => set('referrerSignupRewardTrafficFallbackDays', v)}
              />
              <NumberField
                label="Максимум начислений за сигнап на реферера за 7 дней"
                value={settings.referrerSignupRewardMaxPer7d}
                onChange={(v) => set('referrerSignupRewardMaxPer7d', v)}
              />
            </SettingsSection>

            <SettingsSection
              title="Бонус за оплату другом (конверсия)"
              description="Главный бонус: начисляется пригласившему в момент первой оплаты подписки его другом. Может включать и дни, и постоянную прибавку трафика одновременно."
              defaultOpen
            >
              <div className="field">
                <label>Режим расчёта дней</label>
                <select
                  className="filter-select"
                  value={settings.conversionRewardMode}
                  onChange={(e) => set('conversionRewardMode', e.target.value as ReferralSettings['conversionRewardMode'])}
                >
                  <option value="flat_days">Фиксированные дни</option>
                  <option value="percent_of_purchase">Процент от длительности тарифа</option>
                </select>
              </div>
              <NumberField
                label="Дней (режим «Фиксированные»)"
                value={settings.conversionRewardFlatDays}
                onChange={(v) => set('conversionRewardFlatDays', v)}
              />
              <NumberField
                label="Процент (режим «От длительности тарифа»)"
                value={settings.conversionRewardPercent}
                onChange={(v) => set('conversionRewardPercent', v)}
              />
              <CheckboxField
                label="Постоянная прибавка ГБ/день за оплату"
                checked={settings.conversionTrafficBonusEnabled}
                onChange={(v) => set('conversionTrafficBonusEnabled', v)}
              />
              <NumberField
                label="ГБ/день за оплату (стакается)"
                value={settings.conversionTrafficBonusGb}
                onChange={(v) => set('conversionTrafficBonusGb', v)}
              />
              <NumberField
                label="Потолок стека ГБ/день"
                value={settings.conversionTrafficBonusMaxStackedGb}
                onChange={(v) => set('conversionTrafficBonusMaxStackedGb', v)}
              />
              <NumberField
                label="Дней взамен, если реферер уже на безлимитном платном плане"
                value={settings.conversionTrafficBonusFallbackDays}
                onChange={(v) => set('conversionTrafficBonusFallbackDays', v)}
              />
            </SettingsSection>

            <SettingsSection
              title="Пирамида — уровень 2"
              description="Дополнительный бонус тому, кто пригласил самого пригласившего — «бабушке/дедушке» цепочки. Считается в днях, как процент от бонуса уровня 1 (только дни, без трафика)."
            >
              <NumberField
                label="Процент от дневного бонуса уровня 1"
                value={settings.level2RewardPercent}
                onChange={(v) => set('level2RewardPercent', v)}
              />
            </SettingsSection>

            <SettingsSection
              title="Вехи по количеству оплативших рефералов"
              description="Разовые бонусы за суммарное число друзей, которые оплатили подписку по вашей ссылке (считаются именно оплатившие, а не просто зарегистрированные)."
            >
              {settings.milestones.map((milestone, index) => (
                <div className="field milestone-row" key={index}>
                  <input
                    type="number"
                    min={1}
                    className="search-input"
                    placeholder="Оплатили друзей"
                    value={milestone.convertedCount}
                    onChange={(e) => updateMilestone(index, { convertedCount: Number(e.target.value) })}
                  />
                  <span>→ +</span>
                  <input
                    type="number"
                    min={1}
                    className="search-input"
                    placeholder="Бонус дней"
                    value={milestone.bonusDays}
                    onChange={(e) => updateMilestone(index, { bonusDays: Number(e.target.value) })}
                  />
                  <span>дней</span>
                  <button type="button" onClick={() => removeMilestone(index)}>
                    Удалить
                  </button>
                </div>
              ))}
              <button type="button" onClick={addMilestone}>
                + Добавить веху
              </button>
            </SettingsSection>

            <SettingsSection
              title="Общие ограничители"
              description="Общие лимиты, которые не дают одному аккаунту накопить неограниченное количество бесплатных дней — ни выданных, ни «в банке» неполученных."
            >
              <NumberField
                label="Максимум начислений за оплату на реферера за 30 дней"
                value={settings.maxRewardedConversionsPer30d}
                onChange={(v) => set('maxRewardedConversionsPer30d', v)}
              />
              <NumberField
                label="Максимум «банка» неполученных дней на реферера"
                value={settings.maxBankedDays}
                onChange={(v) => set('maxBankedDays', v)}
              />
            </SettingsSection>

            {saveMessage && <p className="hint">{saveMessage}</p>}
            <button type="submit" disabled={saving} onClick={saveSettings}>
              {saving ? 'Сохраняю…' : 'Сохранить настройки'}
            </button>
          </>
        )}
      </section>
    </>
  );
}
