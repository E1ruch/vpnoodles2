import { TelegramError } from 'telegraf';
import { isTelegramBlockedError } from '../../src/infrastructure/notifications/telegramErrors';

describe('isTelegramBlockedError', () => {
  it('true for 403 "bot was blocked by the user"', () => {
    const err = new TelegramError({
      error_code: 403,
      description: 'Forbidden: bot was blocked by the user',
    });
    expect(isTelegramBlockedError(err)).toBe(true);
  });

  it('true for 403 "user is deactivated"', () => {
    const err = new TelegramError({ error_code: 403, description: 'Forbidden: user is deactivated' });
    expect(isTelegramBlockedError(err)).toBe(true);
  });

  it('false for other 403 errors (e.g. bot cannot initiate conversation)', () => {
    const err = new TelegramError({
      error_code: 403,
      description: "Forbidden: bot can't initiate conversation with a user",
    });
    expect(isTelegramBlockedError(err)).toBe(false);
  });

  it('false for a non-403 TelegramError', () => {
    const err = new TelegramError({ error_code: 400, description: 'Bad Request: chat not found' });
    expect(isTelegramBlockedError(err)).toBe(false);
  });

  it('false for a generic network error', () => {
    expect(isTelegramBlockedError(new Error('network timeout'))).toBe(false);
  });

  it('false for a plain object mimicking the shape without being a real TelegramError', () => {
    // Защита от ложного срабатывания на что-то, что просто похоже на ошибку Telegram,
    // но не пришло из самого telegraf (instanceof, а не проверка полей).
    expect(isTelegramBlockedError({ code: 403, description: 'bot was blocked by the user' })).toBe(
      false,
    );
  });
});
