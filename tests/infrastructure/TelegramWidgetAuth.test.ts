import { createHash, createHmac } from 'node:crypto';
import {
  verifyTelegramWidgetAuth,
  type TelegramWidgetAuthPayload,
} from '../../src/infrastructure/auth/TelegramWidgetAuth';

const BOT_TOKEN = '123456:test-bot-token';

function signPayload(fields: Omit<TelegramWidgetAuthPayload, 'hash'>): TelegramWidgetAuthPayload {
  const dataCheckString = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('\n');

  const secretKey = createHash('sha256').update(BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return { ...fields, hash };
}

describe('verifyTelegramWidgetAuth', () => {
  it('true for a correctly signed, fresh payload', () => {
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      username: 'admin_user',
      auth_date: Math.floor(Date.now() / 1000),
    });

    expect(verifyTelegramWidgetAuth(payload, BOT_TOKEN)).toBe(true);
  });

  it('false when the hash is tampered with', () => {
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      auth_date: Math.floor(Date.now() / 1000),
    });

    const tampered = { ...payload, hash: payload.hash.replace(/^./, payload.hash[0] === 'a' ? 'b' : 'a') };
    expect(verifyTelegramWidgetAuth(tampered, BOT_TOKEN)).toBe(false);
  });

  it('false when a field was modified after signing (e.g. id swapped)', () => {
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      auth_date: Math.floor(Date.now() / 1000),
    });

    expect(verifyTelegramWidgetAuth({ ...payload, id: 999 }, BOT_TOKEN)).toBe(false);
  });

  it('false when signed with a different bot token', () => {
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      auth_date: Math.floor(Date.now() / 1000),
    });

    expect(verifyTelegramWidgetAuth(payload, 'other-token')).toBe(false);
  });

  it('false when auth_date is older than the max age', () => {
    const staleAuthDate = Math.floor(Date.now() / 1000) - 90000;
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      auth_date: staleAuthDate,
    });

    expect(verifyTelegramWidgetAuth(payload, BOT_TOKEN)).toBe(false);
  });

  it('false when auth_date is in the future beyond tolerance', () => {
    const futureAuthDate = Math.floor(Date.now() / 1000) + 90000;
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      auth_date: futureAuthDate,
    });

    expect(verifyTelegramWidgetAuth(payload, BOT_TOKEN)).toBe(false);
  });

  it('respects a custom maxAgeSeconds', () => {
    const authDate = Math.floor(Date.now() / 1000) - 120;
    const payload = signPayload({
      id: 42,
      first_name: 'Admin',
      auth_date: authDate,
    });

    expect(verifyTelegramWidgetAuth(payload, BOT_TOKEN, { maxAgeSeconds: 60 })).toBe(false);
    expect(verifyTelegramWidgetAuth(payload, BOT_TOKEN, { maxAgeSeconds: 300 })).toBe(true);
  });
});
