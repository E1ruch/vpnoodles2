import { GetUserDetailUseCase } from '../../src/application/usecases/GetUserDetailUseCase';

const mockUserRepo = {
  findById: jest.fn(),
};
const mockSubscriptionRepo = {
  findByUserId: jest.fn(),
};
const mockPaymentRepo = {
  findByUserId: jest.fn(),
};
const mockAuditLogRepo = {
  findByUserId: jest.fn(),
};

describe('GetUserDetailUseCase', () => {
  let useCase: GetUserDetailUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new GetUserDetailUseCase(
      mockUserRepo as never,
      mockSubscriptionRepo as never,
      mockPaymentRepo as never,
      mockAuditLogRepo as never,
    );
  });

  it('returns null when the user does not exist, without querying related data', async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    const result = await useCase.execute('missing-id');

    expect(result).toBeNull();
    expect(mockSubscriptionRepo.findByUserId).not.toHaveBeenCalled();
    expect(mockPaymentRepo.findByUserId).not.toHaveBeenCalled();
    expect(mockAuditLogRepo.findByUserId).not.toHaveBeenCalled();
  });

  it('aggregates profile, subscriptions, payments and recent actions for an existing user', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'u1',
      telegramId: 999,
      username: 'bob',
      firstName: 'Bob',
      lastName: null,
      languageCode: 'ru',
      isActive: true,
      hasUsedTrial: true,
      createdAt: new Date('2026-01-01'),
    });
    mockSubscriptionRepo.findByUserId.mockResolvedValue([
      {
        id: 's1',
        plan: { name: 'Pro 30d', type: 'paid' },
        planId: 'plan1',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
        deviceLimit: 3,
        usedDevices: 1,
        isActive: true,
      },
    ]);
    mockPaymentRepo.findByUserId.mockResolvedValue([
      {
        id: 'p1',
        plan: { name: 'Pro 30d' },
        planId: 'plan1',
        amount: 199,
        currency: 'RUB',
        provider: 'yookassa',
        status: 'completed',
        createdAt: new Date('2026-01-01'),
      },
    ]);
    mockAuditLogRepo.findByUserId.mockResolvedValue([
      {
        id: 'a1',
        action: 'subscription_purchased',
        entityType: 'subscription',
        entityId: 's1',
        createdAt: new Date('2026-01-01'),
      },
    ]);

    const result = await useCase.execute('u1');

    expect(mockAuditLogRepo.findByUserId).toHaveBeenCalledWith('u1', 20);
    expect(result).toEqual({
      id: 'u1',
      telegramId: 999,
      username: 'bob',
      firstName: 'Bob',
      lastName: null,
      languageCode: 'ru',
      isActive: true,
      hasUsedTrial: true,
      createdAt: new Date('2026-01-01'),
      subscriptions: [
        {
          id: 's1',
          planName: 'Pro 30d',
          planType: 'paid',
          status: 'active',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-02-01'),
          deviceLimit: 3,
          usedDevices: 1,
          isActive: true,
        },
      ],
      payments: [
        {
          id: 'p1',
          planLabel: 'Pro 30d',
          amount: 199,
          currency: 'RUB',
          provider: 'yookassa',
          status: 'completed',
          createdAt: new Date('2026-01-01'),
        },
      ],
      recentActions: [
        {
          id: 'a1',
          action: 'subscription_purchased',
          entityType: 'subscription',
          entityId: 's1',
          createdAt: new Date('2026-01-01'),
        },
      ],
    });
  });

  it('falls back to planId when a subscription/payment has no joined plan', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'u1',
      telegramId: 1,
      username: null,
      firstName: null,
      lastName: null,
      languageCode: null,
      isActive: true,
      hasUsedTrial: false,
      createdAt: new Date(),
    });
    mockSubscriptionRepo.findByUserId.mockResolvedValue([
      { id: 's1', plan: null, planId: 'plan-x', status: 'expired', startDate: new Date(), endDate: new Date(), deviceLimit: 1, usedDevices: 0, isActive: false },
    ]);
    mockPaymentRepo.findByUserId.mockResolvedValue([
      { id: 'p1', plan: null, planId: 'plan-y', amount: 1, currency: null, provider: 'stars', status: 'pending', createdAt: new Date() },
    ]);
    mockAuditLogRepo.findByUserId.mockResolvedValue([]);

    const result = await useCase.execute('u1');

    expect(result?.subscriptions[0]?.planName).toBe('plan-x');
    expect(result?.payments[0]?.planLabel).toBe('plan-y');
  });
});
