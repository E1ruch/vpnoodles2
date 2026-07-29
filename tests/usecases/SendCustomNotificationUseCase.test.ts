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

const mockSubscriptionRepo = {
  findActiveByUserId: jest.fn(),
};

const mockRenewSubscriptionUseCase = {
  execute: jest.fn(),
};

const mockRemnawaveService = {
  updateTrafficLimit: jest.fn().mockResolvedValue(undefined),
};

const mockPlanRepo = {
  findById: jest.fn(),
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
    mockRemnawaveService.updateTrafficLimit.mockResolvedValue(undefined);
    mockPlanRepo.findById.mockResolvedValue({ type: 'trial' });

    useCase = new SendCustomNotificationUseCase(
      mockBot as never,
      mockUserRepo as never,
      mockAuditLogRepo as never,
      mockDeactivateBlockedUser as never,
      mockCacheService as never,
      mockSubscriptionRepo as never,
      mockRenewSubscriptionUseCase as never,
      mockRemnawaveService as never,
      mockPlanRepo as never,
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

  describe('reward (audience: user only)', () => {
    beforeEach(() => {
      mockUserRepo.findById.mockResolvedValue({ id: 'u1', telegramId: 111, isActive: true });
      mockBot.telegram.sendMessage.mockResolvedValue(undefined);
    });

    it('extends the active subscription via RenewSubscriptionUseCase before sending', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: 'rw-1' });
      mockRenewSubscriptionUseCase.execute.mockResolvedValue({ endDate: new Date('2026-01-01') });

      const result = await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hi',
        reward: { extraDays: 10 },
        adminTelegramId: 999,
      });

      expect(mockRenewSubscriptionUseCase.execute).toHaveBeenCalledWith('sub-1', 10);
      expect(result.rewardApplied).toMatchObject({ extraDays: 10 });
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ reward: expect.objectContaining({ extraDays: 10 }) }) }),
      );
    });

    it('appends a reward notice to the actual message text so the recipient sees what was granted', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: 'rw-1' });
      mockRenewSubscriptionUseCase.execute.mockResolvedValue({ endDate: new Date('2026-01-01') });

      await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'Спасибо!',
        reward: { extraDays: 10, newTrafficLimitGb: 3 },
        adminTelegramId: 999,
      });

      const [, sentText] = mockBot.telegram.sendMessage.mock.calls[0];
      expect(sentText).toBe('Спасибо!\n\n🎁 Мы также продлили подписку на 10 дн. и увеличили лимит трафика до 3 ГБ!');
      expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ text: sentText }) }),
      );
    });

    it('updates the traffic limit converting GB to bytes', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: 'rw-1' });

      const result = await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hi',
        reward: { newTrafficLimitGb: 3 },
        adminTelegramId: 999,
      });

      expect(mockRemnawaveService.updateTrafficLimit).toHaveBeenCalledWith('rw-1', 3 * 1024 * 1024 * 1024);
      expect(result.rewardApplied).toMatchObject({ newTrafficLimitGb: 3 });
    });

    it('applies both extraDays and newTrafficLimitGb together', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: 'rw-1' });
      mockRenewSubscriptionUseCase.execute.mockResolvedValue({ endDate: new Date('2026-01-01') });

      const result = await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hi',
        reward: { extraDays: 5, newTrafficLimitGb: 2 },
        adminTelegramId: 999,
      });

      expect(mockRenewSubscriptionUseCase.execute).toHaveBeenCalledWith('sub-1', 5);
      expect(mockRemnawaveService.updateTrafficLimit).toHaveBeenCalledWith('rw-1', 2 * 1024 * 1024 * 1024);
      expect(result.rewardApplied).toMatchObject({ extraDays: 5, newTrafficLimitGb: 2 });
    });

    it('rejects extending days when the user has no active subscription, without sending a message', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);

      await expect(
        useCase.execute({
          audience: 'user',
          userId: 'u1',
          text: 'hi',
          reward: { extraDays: 10 },
          adminTelegramId: 999,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects changing traffic limit when the subscription has no remnawaveUserId, without sending a message', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: null });

      await expect(
        useCase.execute({
          audience: 'user',
          userId: 'u1',
          text: 'hi',
          reward: { newTrafficLimitGb: 3 },
          adminTelegramId: 999,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a traffic-limit reward for a paid-plan user (unlimited by design), without sending a message', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-paid',
        remnawaveUserId: 'rw-1',
      });
      mockPlanRepo.findById.mockResolvedValue({ id: 'plan-paid', type: 'paid' });

      await expect(
        useCase.execute({
          audience: 'user',
          userId: 'u1',
          text: 'hi',
          reward: { newTrafficLimitGb: 3 },
          adminTelegramId: 999,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockRemnawaveService.updateTrafficLimit).not.toHaveBeenCalled();
      expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('allows a traffic-limit reward for a trial-plan user', async () => {
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-1',
        planId: 'plan-trial',
        remnawaveUserId: 'rw-1',
      });
      mockPlanRepo.findById.mockResolvedValue({ id: 'plan-trial', type: 'trial' });

      const result = await useCase.execute({
        audience: 'user',
        userId: 'u1',
        text: 'hi',
        reward: { newTrafficLimitGb: 3 },
        adminTelegramId: 999,
      });

      expect(mockRemnawaveService.updateTrafficLimit).toHaveBeenCalledWith('rw-1', 3 * 1024 * 1024 * 1024);
      expect(result.rewardApplied).toMatchObject({ newTrafficLimitGb: 3 });
    });

    it('rejects reward when audience is "all"', async () => {
      await expect(
        useCase.execute({ audience: 'all', text: 'hi', reward: { extraDays: 10 }, adminTelegramId: 999 }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mockUserRepo.findAll).not.toHaveBeenCalled();
    });

    it('rejects a non-positive or non-integer extraDays', async () => {
      await expect(
        useCase.execute({
          audience: 'user',
          userId: 'u1',
          text: 'hi',
          reward: { extraDays: 0 },
          adminTelegramId: 999,
        }),
      ).rejects.toBeInstanceOf(ValidationError);

      await expect(
        useCase.execute({
          audience: 'user',
          userId: 'u1',
          text: 'hi',
          reward: { extraDays: 1.5 },
          adminTelegramId: 999,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects an empty reward object with neither field set', async () => {
      await expect(
        useCase.execute({ audience: 'user', userId: 'u1', text: 'hi', reward: {}, adminTelegramId: 999 }),
      ).rejects.toBeInstanceOf(ValidationError);
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
