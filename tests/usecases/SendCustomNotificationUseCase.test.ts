import { TelegramError } from 'telegraf';
import { SendCustomNotificationUseCase } from '../../src/application/usecases/SendCustomNotificationUseCase';
import { ValidationError, NotFoundError, BroadcastLockedError } from '../../src/shared/errors/index';

const mockBot = {
  telegram: {
    sendMessage: jest.fn(),
  },
};

const mockUserRepo = {
  findById: jest.fn(),
  findByTelegramId: jest.fn(),
  findAll: jest.fn(),
};

const mockAuditLogRepo = {
  create: jest.fn().mockResolvedValue({}),
};

const mockDeactivateBlockedUser = {
  execute: jest.fn().mockResolvedValue(undefined),
};

const mockCacheService = {
  acquireLock: jest.fn(),
  releaseLock: jest.fn().mockResolvedValue(undefined),
};

describe('SendCustomNotificationUseCase', () => {
  let useCase: SendCustomNotificationUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDeactivateBlockedUser.execute.mockResolvedValue(undefined);
    mockAuditLogRepo.create.mockResolvedValue({});
    mockCacheService.acquireLock.mockResolvedValue(true);
    mockCacheService.releaseLock.mockResolvedValue(undefined);
    mockUserRepo.findByTelegramId.mockResolvedValue({ id: 'admin-1' });

    useCase = new SendCustomNotificationUseCase(
      mockBot as never,
      mockUserRepo as never,
      mockAuditLogRepo as never,
      mockDeactivateBlockedUser as never,
      mockCacheService as never,
    );
  });

  describe('audience: user', () => {
    it('sends to the user, logs one audit row, and reports queued: false', async () => {
      mockUserRepo.findById.mockResolvedValue({ id: 'u1', telegramId: 111, isActive: true });
      mockBot.telegram.sendMessage.mockResolvedValue(undefined);

      const result = await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hello',
        adminTelegramId: 999,
      });

      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(111, 'hello', { reply_markup: undefined });
      expect(result).toMatchObject({ audience: 'user', recipients: 1, sent: 1, failed: 0, queued: false });
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: 'admin_custom_notification_user',
          entityType: 'user',
          entityId: 'u1',
        }),
      );
    });

    it('builds a URL inline button when one is provided', async () => {
      mockUserRepo.findById.mockResolvedValue({ id: 'u1', telegramId: 111, isActive: true });
      mockBot.telegram.sendMessage.mockResolvedValue(undefined);

      await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hello',
        button: { label: 'Open', url: 'https://example.com' },
        adminTelegramId: 999,
      });

      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(111, 'hello', {
        reply_markup: { inline_keyboard: [[{ text: 'Open', url: 'https://example.com' }]] },
      });
    });

    it('rejects a missing/inactive user before sending anything', async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expect(
        useCase.execute({ audience: 'user', userId: 'missing', text: 'hi', adminTelegramId: 999 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();

      mockUserRepo.findById.mockResolvedValue({ id: 'u2', telegramId: 222, isActive: false });
      await expect(
        useCase.execute({ audience: 'user', userId: 'u2', text: 'hi', adminTelegramId: 999 }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('deactivates the user and counts a failed send when the bot is blocked', async () => {
      mockUserRepo.findById.mockResolvedValue({ id: 'u1', telegramId: 111, isActive: true });
      mockBot.telegram.sendMessage.mockRejectedValue(
        new TelegramError({ error_code: 403, description: 'Forbidden: bot was blocked by the user' }),
      );

      const result = await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hello',
        adminTelegramId: 999,
      });

      expect(result).toMatchObject({ sent: 0, failed: 1 });
      expect(mockDeactivateBlockedUser.execute).toHaveBeenCalledWith('u1');
    });

    it('rejects userId missing for audience "user"', async () => {
      await expect(
        useCase.execute({ audience: 'user', text: 'hi', adminTelegramId: 999 }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects text over the Telegram length limit', async () => {
      await expect(
        useCase.execute({
          audience: 'user',
          userId: 'u1',
          text: 'x'.repeat(4097),
          adminTelegramId: 999,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('audience: all', () => {
    it('filters out inactive users and reports the correct recipient count immediately, queued: true', async () => {
      mockUserRepo.findAll.mockResolvedValue([
        { id: 'u1', telegramId: 1, isActive: true },
        { id: 'u2', telegramId: 2, isActive: false },
        { id: 'u3', telegramId: 3, isActive: undefined },
      ]);
      mockBot.telegram.sendMessage.mockResolvedValue(undefined);

      const result = await useCase.execute({ audience: 'all', text: 'hello everyone', adminTelegramId: 999 });

      expect(result).toMatchObject({ audience: 'all', recipients: 2, sent: 0, failed: 0, queued: true });
      await result.completion;

      expect(mockBot.telegram.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_custom_notification_all',
          entityType: 'broadcast',
          metadata: expect.objectContaining({ recipients: 2, sent: 2, failed: 0 }),
        }),
      );
    });

    it('writes exactly one aggregate audit row, not one per recipient', async () => {
      mockUserRepo.findAll.mockResolvedValue([
        { id: 'u1', telegramId: 1, isActive: true },
        { id: 'u2', telegramId: 2, isActive: true },
      ]);
      mockBot.telegram.sendMessage.mockResolvedValue(undefined);

      const result = await useCase.execute({ audience: 'all', text: 'hi', adminTelegramId: 999 });
      await result.completion;

      expect(mockAuditLogRepo.create).toHaveBeenCalledTimes(1);
    });

    it('deactivates blocked recipients and counts them as failed', async () => {
      mockUserRepo.findAll.mockResolvedValue([
        { id: 'u1', telegramId: 1, isActive: true },
        { id: 'u2', telegramId: 2, isActive: true },
      ]);
      mockBot.telegram.sendMessage
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new TelegramError({ error_code: 403, description: 'Forbidden: user is deactivated' }),
        );

      const result = await useCase.execute({ audience: 'all', text: 'hi', adminTelegramId: 999 });
      await result.completion;

      expect(mockDeactivateBlockedUser.execute).toHaveBeenCalledWith('u2');
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ sent: 1, failed: 1 }) }),
      );
    });

    it('rejects a concurrent "all" broadcast while the lock is held', async () => {
      mockCacheService.acquireLock.mockResolvedValue(false);

      await expect(
        useCase.execute({ audience: 'all', text: 'hi', adminTelegramId: 999 }),
      ).rejects.toBeInstanceOf(BroadcastLockedError);
      expect(mockUserRepo.findAll).not.toHaveBeenCalled();
    });

    it('releases the lock once the background broadcast completes', async () => {
      mockUserRepo.findAll.mockResolvedValue([{ id: 'u1', telegramId: 1, isActive: true }]);
      mockBot.telegram.sendMessage.mockResolvedValue(undefined);

      const result = await useCase.execute({ audience: 'all', text: 'hi', adminTelegramId: 999 });
      await result.completion;

      expect(mockCacheService.releaseLock).toHaveBeenCalledWith('admin:broadcast-all:lock');
    });
  });

  describe('getAudienceCount', () => {
    it('counts only active (or unset) users, matching the send filter', async () => {
      mockUserRepo.findAll.mockResolvedValue([
        { id: 'u1', isActive: true },
        { id: 'u2', isActive: false },
        { id: 'u3', isActive: undefined },
      ]);

      await expect(useCase.getAudienceCount()).resolves.toBe(2);
    });
  });
});
