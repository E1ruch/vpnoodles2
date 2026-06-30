import { SendTrialExpiringRemindersUseCase } from '../../src/application/usecases/SendTrialExpiringRemindersUseCase';

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

describe('SendTrialExpiringRemindersUseCase', () => {
  let useCase: SendTrialExpiringRemindersUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new SendTrialExpiringRemindersUseCase(
      mockSubscriptionRepo as never,
      mockNotificationLogRepo as never,
      mockNotificationService as never,
      mockSyncSubscriptionExpiry as never,
    );
  });

  const trialSub = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'sub-1',
    userId: 'u1',
    planId: 'plan-trial',
    status: 'active',
    startDate: new Date(),
    endDate: inDays(1),
    remnawaveUserId: 'rem-1',
    subscriptionUrl: 'https://sub.example.com',
    plan: { id: 'plan-trial', type: 'trial', name: 'Бесплатный' },
    user: { telegramId: 111 },
    ...overrides,
  });

  it('sends a reminder for an active trial ending within 2 days', async () => {
    const sub = trialSub();
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub); // after sync refresh
    mockNotificationLogRepo.exists.mockResolvedValue(false);

    const result = await useCase.execute();

    expect(result.sent).toBe(1);
    expect(mockSyncSubscriptionExpiry.execute).toHaveBeenCalledWith('sub-1');
    expect(mockNotificationService.send).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'trial_expiring_2d',
        entityId: 'sub-1',
      }),
    );
  });

  it('skips paid subscriptions', async () => {
    const sub = trialSub({
      id: 'sub-paid',
      planId: 'plan-paid',
      plan: { id: 'plan-paid', type: 'paid', name: '1 месяц' },
    });
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);

    const result = await useCase.execute();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('skips when reminder for this cycle was already sent (dedup)', async () => {
    const sub = trialSub();
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub);
    mockNotificationLogRepo.exists.mockResolvedValue(true);

    const result = await useCase.execute();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('skips when after sync the subscription became expired', async () => {
    const sub = trialSub();
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

  it('re-sends after renewal (new cycleKey from new endDate)', async () => {
    const sub = trialSub({ endDate: inDays(1) });
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([sub]);
    mockSubscriptionRepo.findById.mockResolvedValue(sub);
    // exists checks by (userId, type, entityId, cycleKey) — different cycleKey => not sent
    mockNotificationLogRepo.exists.mockResolvedValue(false);

    const result = await useCase.execute();
    expect(result.sent).toBe(1);

    // Simulate next cycle: endDate moved further by renewal → outside window now
    const renewedSub = trialSub({ endDate: inDays(14) });
    mockSubscriptionRepo.findActiveExpiringWithinDays.mockResolvedValue([]); // not in 2-day window
    const result2 = await useCase.execute();
    expect(result2.sent).toBe(0);
  });
});
