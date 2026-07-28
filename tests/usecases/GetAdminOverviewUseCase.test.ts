import { GetAdminOverviewUseCase } from '../../src/application/usecases/GetAdminOverviewUseCase';

const mockUserRepo = {
  findAll: jest.fn(),
};

const mockSubscriptionRepo = {
  findAll: jest.fn(),
};

const mockPaymentRepo = {
  getRevenueSummary: jest.fn(),
  findAll: jest.fn(),
};

const mockAuditLogRepo = {
  count: jest.fn(),
};

const mockNotificationLogRepo = {
  getStats: jest.fn(),
};

const revenueSummary = {
  today: [],
  last7Days: [],
  last30Days: [],
  allTime: [{ provider: 'yookassa', currency: 'RUB', total: 1000, count: 5 }],
};

const notificationStats = {
  total: 10,
  delivered: 8,
  failed: 2,
  byType: [],
};

describe('GetAdminOverviewUseCase', () => {
  let useCase: GetAdminOverviewUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new GetAdminOverviewUseCase(
      mockUserRepo as never,
      mockSubscriptionRepo as never,
      mockPaymentRepo as never,
      mockAuditLogRepo as never,
      mockNotificationLogRepo as never,
    );
  });

  it('aggregates counts, active-only breakdowns, revenue, notifications and recent payments', async () => {
    mockUserRepo.findAll.mockResolvedValue([
      { id: 'u1', isActive: true },
      { id: 'u2', isActive: false },
      { id: 'u3', isActive: true },
    ]);
    mockSubscriptionRepo.findAll.mockResolvedValue([
      { id: 's1', isActive: true },
      { id: 's2', isActive: false },
    ]);
    mockAuditLogRepo.count.mockResolvedValue(42);
    mockPaymentRepo.getRevenueSummary.mockResolvedValue(revenueSummary);
    mockNotificationLogRepo.getStats.mockResolvedValue(notificationStats);
    mockPaymentRepo.findAll.mockResolvedValue([
      {
        id: 'p1',
        user: { username: 'alice', firstName: 'Alice' },
        plan: { name: 'Pro' },
        userId: 'u1',
        planId: 'plan1',
        amount: 199,
        currency: 'RUB',
        provider: 'yookassa',
        status: 'completed',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'p2',
        user: null,
        plan: null,
        userId: 'u2',
        planId: 'plan2',
        amount: 50,
        currency: 'XTR',
        provider: 'stars',
        status: 'completed',
        createdAt: new Date('2026-01-02'),
      },
    ]);

    const result = await useCase.execute();

    expect(result.usersCount).toBe(3);
    expect(result.activeUsersCount).toBe(2);
    expect(result.subscriptionsCount).toBe(2);
    expect(result.activeSubscriptionsCount).toBe(1);
    expect(result.paymentsCount).toBe(2);
    expect(result.logsCount).toBe(42);
    expect(result.revenue).toBe(revenueSummary);
    expect(result.notifications).toBe(notificationStats);
    expect(result.recentPayments).toEqual([
      {
        id: 'p1',
        userLabel: '@alice',
        planLabel: 'Pro',
        amount: 199,
        currency: 'RUB',
        provider: 'yookassa',
        status: 'completed',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'p2',
        userLabel: 'u2',
        planLabel: 'plan2',
        amount: 50,
        currency: 'XTR',
        provider: 'stars',
        status: 'completed',
        createdAt: new Date('2026-01-02'),
      },
    ]);
  });

  it('caps recentPayments at 10 entries even with more completed payments', async () => {
    mockUserRepo.findAll.mockResolvedValue([]);
    mockSubscriptionRepo.findAll.mockResolvedValue([]);
    mockAuditLogRepo.count.mockResolvedValue(0);
    mockPaymentRepo.getRevenueSummary.mockResolvedValue(revenueSummary);
    mockNotificationLogRepo.getStats.mockResolvedValue(notificationStats);
    mockPaymentRepo.findAll.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({
        id: `p${i}`,
        user: { username: `user${i}` },
        plan: { name: 'Plan' },
        userId: `u${i}`,
        planId: 'plan1',
        amount: 100,
        currency: 'RUB',
        provider: 'yookassa',
        status: 'completed',
        createdAt: new Date(),
      })),
    );

    const result = await useCase.execute();

    expect(result.paymentsCount).toBe(15);
    expect(result.recentPayments).toHaveLength(10);
  });
});
