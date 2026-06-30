import { SendNoSubscriptionRemindersUseCase } from '../../src/application/usecases/SendNoSubscriptionRemindersUseCase';

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

const mockUserRepo = {
  findById: jest.fn(),
  findByTelegramId: jest.fn(),
  findAll: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockSubscriptionRepo = {
  findById: jest.fn(),
  findActiveByUserId: jest.fn(),
  findByUserId: jest.fn(),
  findAll: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findExpiringSoon: jest.fn(),
  findActiveExpiringWithinDays: jest.fn(),
};

const mockNotificationLogRepo = {
  create: jest.fn().mockResolvedValue({}),
  exists: jest.fn().mockResolvedValue(false),
  findByUserAndType: jest.fn(),
};

const mockNotificationService = {
  send: jest.fn().mockResolvedValue(true),
};

describe('SendNoSubscriptionRemindersUseCase', () => {
  let useCase: SendNoSubscriptionRemindersUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new SendNoSubscriptionRemindersUseCase(
      mockUserRepo as never,
      mockSubscriptionRepo as never,
      mockNotificationLogRepo as never,
      mockNotificationService as never,
    );
  });

  it('sends wave-1 reminder for a user without subscription after 1h', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      {
        id: 'u1',
        telegramId: 111,
        firstName: 'Иван',
        isActive: true,
        createdAt: hoursAgo(2),
      },
    ]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
    mockNotificationLogRepo.exists.mockResolvedValue(false);

    const result = await useCase.execute();

    expect(result.sentWave1).toBe(1);
    expect(result.sentWave2).toBe(0);
    expect(mockNotificationService.send).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'no_subscription_reminder_1h' }),
    );
  });

  it('sends wave-2 reminder after 3 days when wave-1 already sent', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      {
        id: 'u2',
        telegramId: 222,
        firstName: null,
        isActive: true,
        createdAt: daysAgo(5),
      },
    ]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
    // wave1 already in log, wave2 not yet
    mockNotificationLogRepo.exists.mockImplementation(
      async (_u: string, type: string) => type === 'no_subscription_reminder_1h',
    );

    const result = await useCase.execute();

    expect(result.sentWave1).toBe(0);
    expect(result.sentWave2).toBe(1);
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', type: 'no_subscription_reminder_3d' }),
    );
  });

  it('skips users registered less than 1h ago', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      { id: 'u3', telegramId: 333, isActive: true, createdAt: hoursAgo(0.2) },
    ]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);

    const result = await useCase.execute();

    expect(result.sentWave1).toBe(0);
    expect(result.sentWave2).toBe(0);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('skips users who already have a subscription (any)', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      { id: 'u4', telegramId: 444, isActive: true, createdAt: daysAgo(10) },
    ]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([{ id: 'sub-x', planId: 'p1' }]);

    const result = await useCase.execute();

    expect(result.sentWave1).toBe(0);
    expect(result.sentWave2).toBe(0);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('skips inactive users', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      { id: 'u5', telegramId: 555, isActive: false, createdAt: daysAgo(10) },
    ]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);

    const result = await useCase.execute();

    expect(result.sentWave1).toBe(0);
    expect(result.sentWave2).toBe(0);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('does not re-send a wave that was already delivered (dedup)', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      { id: 'u6', telegramId: 666, isActive: true, createdAt: hoursAgo(2) },
    ]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
    mockNotificationLogRepo.exists.mockResolvedValue(true);

    const result = await useCase.execute();

    expect(result.sentWave1).toBe(0);
    expect(result.failed).toBe(0);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });
});
