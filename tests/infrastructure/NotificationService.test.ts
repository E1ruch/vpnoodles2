import { TelegramError } from 'telegraf';
import { NotificationService } from '../../src/infrastructure/notifications/NotificationService';

const mockBot = {
  telegram: {
    sendMessage: jest.fn(),
  },
};

const mockNotificationLogRepo = {
  create: jest.fn().mockResolvedValue({}),
};

const mockDeactivateBlockedUser = {
  execute: jest.fn().mockResolvedValue(undefined),
};

describe('NotificationService — blocked user detection', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeactivateBlockedUser.execute.mockResolvedValue(undefined);
    service = new NotificationService(
      mockBot as never,
      mockNotificationLogRepo as never,
      mockDeactivateBlockedUser as never,
    );
  });

  const baseInput = {
    userId: 'u1',
    telegramId: 111,
    type: 'no_subscription_reminder_1h' as const,
    text: 'hi',
  };

  it('returns true and does not deactivate on a successful send', async () => {
    mockBot.telegram.sendMessage.mockResolvedValue(undefined);

    const delivered = await service.send(baseInput);

    expect(delivered).toBe(true);
    expect(mockDeactivateBlockedUser.execute).not.toHaveBeenCalled();
  });

  it('deactivates the user when Telegram reports the bot was blocked', async () => {
    mockBot.telegram.sendMessage.mockRejectedValue(
      new TelegramError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' }),
    );

    const delivered = await service.send(baseInput);

    expect(delivered).toBe(false);
    expect(mockDeactivateBlockedUser.execute).toHaveBeenCalledWith('u1');
    // Провал доставки всё равно фиксируется в notification_logs, как и раньше.
    expect(mockNotificationLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', delivered: false }),
    );
  });

  it('does not deactivate on an unrelated/transient send failure', async () => {
    mockBot.telegram.sendMessage.mockRejectedValue(new Error('network timeout'));

    const delivered = await service.send(baseInput);

    expect(delivered).toBe(false);
    expect(mockDeactivateBlockedUser.execute).not.toHaveBeenCalled();
  });

  it('does not let a deactivation failure crash the send() call', async () => {
    mockBot.telegram.sendMessage.mockRejectedValue(
      new TelegramError({ error_code: 403, description: 'Forbidden: user is deactivated' }),
    );
    mockDeactivateBlockedUser.execute.mockRejectedValue(new Error('db down'));

    await expect(service.send(baseInput)).resolves.toBe(false);
  });
});
