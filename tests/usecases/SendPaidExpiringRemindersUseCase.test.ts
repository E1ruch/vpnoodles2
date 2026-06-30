import { SendPaidExpiringRemindersUseCase } from '../../src/application/usecases/SendPaidExpiringRemindersUseCase';

const inDays = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000);

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

const mockSyncSubscriptionExpiry = {
  execute: jest.fn().mockResolvedValue(undefined),
};

describe('SendPaidExpiringRemindersUseCase', () => {
  let useCase: SendPaidExpiringRemindersUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new SendPaidExpiringRemindersUseCase(
      mockSubscriptionRepo as never,
      mockNotificationLogRepo as never,
      mockNotificationService as never,
      mockSyncSubscriptionExpiry as never,
    );
  });

  const paidSub = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'sub-paid-1',
    userId: 'u1',
    planId: 'plan-paid',
    status: 'active',
    startDate: new Date(),
    endDate: inDays(1),
    remnawaveUserId: 'rem-1',
    subscriptionUrl: 'https://sub.example.com',
    plan: { id: 'plan-paid', type: 'paid', name: '1 месяц' },
    user: { telegramId: 111 },
    ...overrides,
  });

  it('sends a reminder for an active paid subscription ending within 2 days', async () => {
    const sub = paidSub();
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub); // after sync refresh
    mockNotificationLogRepo.exists.mockResolvedValue(false);

    const result = await useCase.execute();

    expect(result.sent).toBe(1);
    expect(mockSyncSubscriptionExpiry.execute).toHaveBeenCalledWith('sub-paid-1');
    expect(mockNotificationService.send).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'paid_expiring_2d',
        entityId: 'sub-paid-1',
      }),
    );
  });

  it('includes plan name in the message', async () => {
    const sub = paidSub();
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub);
    mockNotificationLogRepo.exists.mockResolvedValue(false);

    await useCase.execute();

    const call = mockNotificationService.send.mock.calls[0][0];
    expect(call.text).toContain('1 месяц');
  });

  it('skips trial subscriptions', async () => {
    const sub = paidSub({
      id: 'sub-trial',
      planId: 'plan-trial',
      plan: { id: 'plan-trial', type: 'trial', name: 'Бесплатный' },
    });
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);

    const result = await useCase.execute();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('skips when reminder for this cycle was already sent (dedup)', async () => {
    const sub = paidSub();
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub);
    mockNotificationLogRepo.exists.mockResolvedValue(true);

    const result = await useCase.execute();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('skips when after sync the subscription became expired', async () => {
    const sub = paidSub();
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue({
      ...sub,
      status: 'expired',
      endDate: new Date(Date.now() - 1000),
    });

    const result = await useCase.execute();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('does not send for subscriptions ending outside the window', async () => {
    const sub = paidSub({ endDate: inDays(10) });
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub);

    const result = await useCase.execute();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
