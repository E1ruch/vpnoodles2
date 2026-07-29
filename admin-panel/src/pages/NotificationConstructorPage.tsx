import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getAudienceCount,
  getUser,
  getUsers,
  sendCustomNotification,
  type SendCustomNotificationReward,
  type SendCustomNotificationResult,
  type UserListEntry,
} from '../api';
import { PageHeader } from '../components/PageHeader';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const TEXT_MAX_LENGTH = 4096;
const CONFIRM_ALL_PHRASE = 'ОТПРАВИТЬ';

const MESSAGE_TEMPLATES: Array<{ id: string; label: string; text: string }> = [
  {
    id: 'gratitude',
    label: '🙏 Благодарность',
    text: 'Спасибо, что вы с нами! Очень ценим, что вы выбираете наш VPN — это помогает нам делать сервис лучше.',
  },
  {
    id: 'apology',
    label: '😔 Извинения',
    text: 'Приносим извинения за перебои в работе сервиса. Мы уже всё исправили и хотим компенсировать неудобства.',
  },
  {
    id: 'holiday',
    label: '🎉 Праздничный подарок',
    text: 'Поздравляем с праздником! В честь этого дарим вам небольшой подарок — приятного пользования VPN 🎁',
  },
  {
    id: 'reactivation',
    label: '👋 Реактивация',
    text: 'Давно вас не было! Мы соскучились — возвращайтесь, специально для вас есть приятный бонус.',
  },
  {
    id: 'vip',
    label: '⭐ VIP-лояльность',
    text: 'Вы один из самых активных пользователей нашего VPN — спасибо за доверие! В знак благодарности дарим бонус.',
  },
];

function formatRewardApplied(reward: Record<string, unknown> | null): string | null {
  if (!reward) return null;
  const parts: string[] = [];
  if (typeof reward['extraDays'] === 'number') parts.push(`+${reward['extraDays']} дней`);
  if (typeof reward['newTrafficLimitGb'] === 'number') parts.push(`лимит трафика → ${reward['newTrafficLimitGb']} ГБ`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function TelegramPreview({ text, buttonLabel }: { text: string; buttonLabel: string | null }) {
  const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="tg-preview">
      <div className="tg-bubble">
        <p className={`tg-bubble-text${text ? '' : ' tg-bubble-placeholder'}`}>
          {text || 'Текст появится здесь по мере ввода…'}
        </p>
        <span className="tg-bubble-time">{time}</span>
      </div>
      {buttonLabel && (
        <div className="tg-button-row">
          <span className="tg-button">🔗 {buttonLabel}</span>
        </div>
      )}
    </div>
  );
}

export function NotificationConstructorPage() {
  const [audience, setAudience] = useState<'user' | 'all'>('user');

  const [text, setText] = useState('');
  const [buttonEnabled, setButtonEnabled] = useState(false);
  const [buttonLabel, setButtonLabel] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');

  const [rewardDaysEnabled, setRewardDaysEnabled] = useState(false);
  const [rewardDays, setRewardDays] = useState('');
  const [rewardTrafficEnabled, setRewardTrafficEnabled] = useState(false);
  const [rewardTrafficGb, setRewardTrafficGb] = useState('');

  const [userSearch, setUserSearch] = useState('');
  const debouncedUserSearch = useDebouncedValue(userSearch);
  const [userResults, setUserResults] = useState<UserListEntry[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserListEntry | null>(null);
  const [selectedUserPlanType, setSelectedUserPlanType] = useState<'trial' | 'paid' | null>(null);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  const [confirmingUser, setConfirmingUser] = useState(false);

  const [confirmingAll, setConfirmingAll] = useState(false);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceCountError, setAudienceCountError] = useState<string | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState('');

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [result, setResult] = useState<SendCustomNotificationResult | null>(null);

  useEffect(() => {
    if (audience !== 'user' || !debouncedUserSearch.trim()) {
      setUserResults([]);
      return;
    }
    setUserSearchError(null);
    getUsers({ search: debouncedUserSearch, page: 0, pageSize: 8 })
      .then((res) => setUserResults(res.items))
      .catch(() => setUserSearchError('Не удалось найти пользователей.'));
  }, [audience, debouncedUserSearch]);

  const resetOutcome = useCallback(() => {
    setSendError(null);
    setResult(null);
  }, []);

  useEffect(() => {
    if (selectedUserPlanType === 'paid') {
      setRewardTrafficEnabled(false);
      setRewardTrafficGb('');
    }
  }, [selectedUserPlanType]);

  const textTrimmed = text.trim();
  const textOverLimit = text.length > TEXT_MAX_LENGTH;
  const buttonValid = !buttonEnabled || (buttonLabel.trim() !== '' && isValidHttpUrl(buttonUrl.trim()));

  const extraDaysNum = Number(rewardDays);
  const extraDaysValid = !rewardDaysEnabled || (Number.isInteger(extraDaysNum) && extraDaysNum > 0);
  const trafficGbNum = Number(rewardTrafficGb);
  const trafficValid = !rewardTrafficEnabled || (Number.isFinite(trafficGbNum) && trafficGbNum > 0);
  const rewardValid = extraDaysValid && trafficValid;
  const hasReward = audience === 'user' && (rewardDaysEnabled || rewardTrafficEnabled);
  const reward: SendCustomNotificationReward | null = hasReward
    ? {
        extraDays: rewardDaysEnabled ? extraDaysNum : undefined,
        newTrafficLimitGb: rewardTrafficEnabled ? trafficGbNum : undefined,
      }
    : null;

  const messageValid =
    textTrimmed !== '' && !textOverLimit && buttonValid && (audience !== 'user' || rewardValid);

  const button = buttonEnabled ? { label: buttonLabel.trim(), url: buttonUrl.trim() } : null;

  const rewardSummaryParts = [
    rewardDaysEnabled && extraDaysValid ? `+${extraDaysNum} дней` : null,
    rewardTrafficEnabled && trafficValid ? `лимит трафика → ${trafficGbNum} ГБ` : null,
  ].filter((part): part is string => Boolean(part));

  // Тот же текст, что бэкенд допишет к реальному сообщению (SendCustomNotificationUseCase
  // buildRewardNotice) — превью должно показывать ровно то, что получит пользователь.
  const rewardNoticeParts = [
    rewardDaysEnabled && extraDaysValid ? `продлили подписку на ${extraDaysNum} дн.` : null,
    rewardTrafficEnabled && trafficValid ? `увеличили лимит трафика до ${trafficGbNum} ГБ` : null,
  ].filter((part): part is string => Boolean(part));
  const rewardNotice = rewardNoticeParts.length > 0 ? `\n\n🎁 Мы также ${rewardNoticeParts.join(' и ')}!` : '';
  const previewText = textTrimmed + (audience === 'user' ? rewardNotice : '');

  function switchAudience(next: 'user' | 'all') {
    setAudience(next);
    resetOutcome();
    setConfirmingUser(false);
    setConfirmingAll(false);
    setConfirmPhrase('');
  }

  async function openAllConfirmation() {
    resetOutcome();
    setConfirmingAll(true);
    setAudienceCount(null);
    setAudienceCountError(null);
    setConfirmPhrase('');
    try {
      const { count } = await getAudienceCount('all');
      setAudienceCount(count);
    } catch {
      setAudienceCountError('Не удалось посчитать получателей.');
    }
  }

  async function submitToUser() {
    if (!selectedUser) return;
    resetOutcome();
    setSending(true);
    try {
      const res = await sendCustomNotification({
        audience: 'user',
        userId: selectedUser.id,
        text: textTrimmed,
        button,
        reward,
      });
      setResult(res);
      setConfirmingUser(false);
    } catch {
      setSendError('Не удалось отправить сообщение.');
    } finally {
      setSending(false);
    }
  }

  function selectUser(u: UserListEntry) {
    setSelectedUser(u);
    setUserResults([]);
    setSelectedUserPlanType(null);
    getUser(u.id)
      .then((detail) => {
        const activeSub = detail.subscriptions.find((s) => s.isActive);
        setSelectedUserPlanType(activeSub?.planType ?? null);
      })
      .catch(() => setSelectedUserPlanType(null));
  }

  async function submitToAll() {
    resetOutcome();
    setSending(true);
    try {
      const res = await sendCustomNotification({ audience: 'all', text: textTrimmed, button });
      setResult(res);
      setConfirmingAll(false);
    } catch {
      setSendError('Не удалось запустить рассылку.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader title="Конструктор" />

      <section className="card">
        <div className="segmented">
          <button
            type="button"
            className={audience === 'user' ? 'active' : ''}
            onClick={() => switchAudience('user')}
          >
            Одному пользователю
          </button>
          <button type="button" className={audience === 'all' ? 'active' : ''} onClick={() => switchAudience('all')}>
            Всем активным
          </button>
        </div>

        {audience === 'user' && (
          <div className="field">
            <label>Получатель</label>
            <input
              type="text"
              className="search-input"
              placeholder="Поиск по имени, юзернейму или telegram id"
              value={userSearch}
              onChange={(e) => {
                setUserSearch(e.target.value);
                setSelectedUser(null);
                setSelectedUserPlanType(null);
              }}
            />
            {userSearchError && <p className="error">{userSearchError}</p>}
            {selectedUser ? (
              <p className="hint">
                Выбран:{' '}
                <strong>
                  {selectedUser.firstName ?? 'Без имени'}
                  {selectedUser.username ? ` (@${selectedUser.username})` : ''} · TG {selectedUser.telegramId}
                </strong>
                {selectedUserPlanType === 'paid' && ' · платный тариф (трафик безлимитный)'}
              </p>
            ) : (
              userResults.length > 0 && (
                <ul className="user-pick-results">
                  {userResults.map((u) => (
                    <li key={u.id}>
                      <button type="button" onClick={() => selectUser(u)}>
                        {u.firstName ?? 'Без имени'}
                        {u.username ? ` (@${u.username})` : ''} · TG {u.telegramId}
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        )}

        <div className="field">
          <label>Шаблоны</label>
          <div className="template-buttons">
            {MESSAGE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="template-button"
                onClick={() => setText(template.text)}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Текст сообщения</label>
          <textarea
            className="search-input constructor-textarea"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Текст, который увидит пользователь в Telegram"
          />
          <p className={`hint char-counter${textOverLimit ? ' error' : ''}`}>
            {text.length} / {TEXT_MAX_LENGTH}
          </p>
        </div>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={buttonEnabled}
              onChange={(e) => setButtonEnabled(e.target.checked)}
            />{' '}
            Добавить кнопку со ссылкой
          </label>
          {buttonEnabled && (
            <div className="button-fields">
              <input
                type="text"
                className="search-input"
                placeholder="Текст кнопки"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
              />
              <input
                type="text"
                className="search-input"
                placeholder="https://..."
                value={buttonUrl}
                onChange={(e) => setButtonUrl(e.target.value)}
              />
              {buttonUrl.trim() !== '' && !isValidHttpUrl(buttonUrl.trim()) && (
                <p className="error">Ссылка должна быть корректным http(s)-адресом.</p>
              )}
            </div>
          )}
        </div>

        {audience === 'user' && (
          <div className="field">
            <label>Награда (необязательно)</label>
            <div className="reward-controls">
              <div className="reward-item">
                <label className="reward-toggle">
                  <input
                    type="checkbox"
                    checked={rewardDaysEnabled}
                    onChange={(e) => setRewardDaysEnabled(e.target.checked)}
                  />
                  Продлить подписку на
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="search-input reward-number"
                    placeholder="дней"
                    value={rewardDays}
                    disabled={!rewardDaysEnabled}
                    onChange={(e) => setRewardDays(e.target.value)}
                  />
                  дней
                </label>
                {rewardDaysEnabled && !extraDaysValid && (
                  <p className="error">Введите целое число дней больше 0.</p>
                )}
              </div>

              <div className="reward-item">
                <label className="reward-toggle">
                  <input
                    type="checkbox"
                    checked={rewardTrafficEnabled}
                    disabled={selectedUserPlanType === 'paid'}
                    onChange={(e) => setRewardTrafficEnabled(e.target.checked)}
                  />
                  Установить лимит трафика
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    className="search-input reward-number"
                    placeholder="ГБ"
                    value={rewardTrafficGb}
                    disabled={!rewardTrafficEnabled || selectedUserPlanType === 'paid'}
                    onChange={(e) => setRewardTrafficGb(e.target.value)}
                  />
                  ГБ
                </label>
                {selectedUserPlanType === 'paid' ? (
                  <p className="hint">У пользователя платный тариф — трафик безлимитный, менять нельзя.</p>
                ) : (
                  rewardTrafficEnabled && !trafficValid && <p className="error">Введите число ГБ больше 0.</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="field">
          <label>Предпросмотр в Telegram</label>
          <TelegramPreview text={previewText} buttonLabel={buttonEnabled && buttonLabel.trim() ? buttonLabel.trim() : null} />
        </div>

        {sendError && <p className="error">{sendError}</p>}

        {result && (
          <p className="hint constructor-result">
            {result.queued
              ? `Рассылка запущена для ${result.recipients} пользователей — результат появится в `
              : `Отправлено: ${result.sent}${result.failed > 0 ? `, ошибок: ${result.failed}` : ''} — подробности в `}
            <Link to="/logs">Логах</Link>.
            {formatRewardApplied(result.rewardApplied) && ` Выдано: ${formatRewardApplied(result.rewardApplied)}.`}
          </p>
        )}

        {audience === 'user' &&
          (!confirmingUser ? (
            <button
              type="submit"
              disabled={!selectedUser || !messageValid}
              onClick={() => setConfirmingUser(true)}
            >
              Отправить
            </button>
          ) : (
            <div className="confirm-box">
              <p>
                {hasReward
                  ? `Отправить сообщение и выдать награду (${rewardSummaryParts.join(', ')}) пользователю `
                  : 'Отправить это сообщение пользователю '}
                <strong>{selectedUser?.firstName ?? 'Без имени'}</strong>?
              </p>
              <div className="confirm-box-actions">
                <button type="button" onClick={() => setConfirmingUser(false)} disabled={sending}>
                  Отмена
                </button>
                <button type="submit" onClick={submitToUser} disabled={sending}>
                  {sending ? 'Отправляю…' : 'Точно отправить'}
                </button>
              </div>
            </div>
          ))}

        {audience === 'all' &&
          (!confirmingAll ? (
            <button type="submit" disabled={!messageValid} onClick={openAllConfirmation}>
              Просмотреть и отправить
            </button>
          ) : (
            <div className="confirm-box confirm-box-all">
              <h3>Подтверждение рассылки всем</h3>
              {audienceCountError && <p className="error">{audienceCountError}</p>}
              {audienceCount === null && !audienceCountError && <p className="hint">Считаю получателей…</p>}
              {audienceCount !== null && (
                <p className="hint">
                  Получателей: <strong>{audienceCount}</strong>
                </p>
              )}

              <label>
                Чтобы подтвердить, введите слово «{CONFIRM_ALL_PHRASE}»
                <input
                  type="text"
                  className="search-input"
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                />
              </label>

              <div className="confirm-box-actions">
                <button type="button" onClick={() => setConfirmingAll(false)} disabled={sending}>
                  Отмена
                </button>
                <button
                  type="submit"
                  onClick={submitToAll}
                  disabled={sending || confirmPhrase !== CONFIRM_ALL_PHRASE || audienceCount === null}
                >
                  {sending ? 'Запускаю…' : `Отправить ${audienceCount ?? ''} пользователям`}
                </button>
              </div>
            </div>
          ))}
      </section>
    </>
  );
}
