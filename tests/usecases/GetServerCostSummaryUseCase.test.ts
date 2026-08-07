import { GetServerCostSummaryUseCase } from '../../src/application/usecases/GetServerCostSummaryUseCase';

const mockServerCostRepo = {
  findAll: jest.fn(),
};

const mockPaymentRepo = {
  getMonthlyRevenueRub: jest.fn(),
};

describe('GetServerCostSummaryUseCase', () => {
  let useCase: GetServerCostSummaryUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T12:00:00Z'));
    useCase = new GetServerCostSummaryUseCase(mockServerCostRepo as never, mockPaymentRepo as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sums costs, gap-fills missing months with 0 revenue, and computes coverage from the latest month', async () => {
    mockServerCostRepo.findAll.mockResolvedValue([{ monthlyCostRub: 1000 }, { monthlyCostRub: 500 }]);
    mockPaymentRepo.getMonthlyRevenueRub.mockResolvedValue([
      { month: '2026-01', totalRub: 800 },
      { month: '2026-03', totalRub: 2000 },
    ]);

    const result = await useCase.execute(3);

    expect(mockPaymentRepo.getMonthlyRevenueRub).toHaveBeenCalledWith(3);
    expect(result.totalMonthlyCostRub).toBe(1500);
    expect(result.monthlyHistory).toEqual([
      { month: '2026-01', revenueRub: 800, costRub: 1500 },
      { month: '2026-02', revenueRub: 0, costRub: 1500 },
      { month: '2026-03', revenueRub: 2000, costRub: 1500 },
    ]);
    expect(result.currentMonthRevenueRub).toBe(2000);
    expect(result.coveragePercent).toBe(133);
  });

  it('returns coveragePercent null when there is no monthly cost configured', async () => {
    mockServerCostRepo.findAll.mockResolvedValue([]);
    mockPaymentRepo.getMonthlyRevenueRub.mockResolvedValue([{ month: '2026-03', totalRub: 500 }]);

    const result = await useCase.execute(3);

    expect(result.totalMonthlyCostRub).toBe(0);
    expect(result.coveragePercent).toBeNull();
  });

  it('defaults to 12 months when no argument is passed', async () => {
    mockServerCostRepo.findAll.mockResolvedValue([]);
    mockPaymentRepo.getMonthlyRevenueRub.mockResolvedValue([]);

    const result = await useCase.execute();

    expect(mockPaymentRepo.getMonthlyRevenueRub).toHaveBeenCalledWith(12);
    expect(result.monthlyHistory).toHaveLength(12);
  });
});
