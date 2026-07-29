import { GetAdminOverviewUseCase } from '../../src/application/usecases/GetAdminOverviewUseCase';

const mockUserRepo = {
  findAll: jest.fn(),
};

const mockSubscriptionRepo = {
  findAll: jest.fn(),
};

const mockPaymentRepo = {
  getRevenueSummary: jest.fn(),
  count: jest.fn(),
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

  it('aggregates counts, active-only breakdowns, revenue and notifications', async () => {
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
    mockPaymentRepo.count.mockResolvedValue(2);

    const result = await useCase.execute();

    expect(result.usersCount).toBe(3);
    expect(result.activeUsersCount).toBe(2);
    expect(result.subscriptionsCount).toBe(2);
    expect(result.activeSubscriptionsCount).toBe(1);
    expect(result.paymentsCount).toBe(2);
    expect(result.logsCount).toBe(42);
    expect(result.revenue).toBe(revenueSummary);
    expect(result.notifications).toBe(notificationStats);
    expect(result).not.toHaveProperty('recentPayments');
  });

  it('handles empty users/subscriptions without error', async () => {
    mockUserRepo.findAll.mockResolvedValue([]);
    mockSubscriptionRepo.findAll.mockResolvedValue([]);
    mockAuditLogRepo.count.mockResolvedValue(0);
    mockPaymentRepo.getRevenueSummary.mockResolvedValue(revenueSummary);
    mockNotificationLogRepo.getStats.mockResolvedValue(notificationStats);
    mockPaymentRepo.count.mockResolvedValue(0);

    const result = await useCase.execute();

    expect(result.usersCount).toBe(0);
    expect(result.activeUsersCount).toBe(0);
    expect(result.subscriptionsCount).toBe(0);
    expect(result.paymentsCount).toBe(0);
  });
});
