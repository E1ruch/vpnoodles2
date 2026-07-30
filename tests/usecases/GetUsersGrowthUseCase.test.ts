import { GetUsersGrowthUseCase } from '../../src/application/usecases/GetUsersGrowthUseCase';

const mockUserRepo = {
  countCreatedBefore: jest.fn(),
  getDailyRegistrations: jest.fn(),
};

describe('GetUsersGrowthUseCase', () => {
  let useCase: GetUsersGrowthUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new GetUsersGrowthUseCase(mockUserRepo as never);
  });

  it('returns exactly `days` points, running a cumulative total from the baseline', async () => {
    mockUserRepo.countCreatedBefore.mockResolvedValue(100);
    mockUserRepo.getDailyRegistrations.mockResolvedValue([]);

    const result = await useCase.execute(7);

    expect(result.days).toBe(7);
    expect(result.series).toHaveLength(7);
    // Без новых регистраций итог остаётся равным базе на каждый день.
    expect(result.series.every((point) => point.totalUsers === 100 && point.newUsers === 0)).toBe(true);
  });

  it('accumulates new registrations day by day on top of the baseline', async () => {
    mockUserRepo.countCreatedBefore.mockResolvedValue(10);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayKey = (offsetFromEnd: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - offsetFromEnd);
      return d.toISOString().slice(0, 10);
    };

    // days=3 → диапазон: today-2, today-1, today. Регистрации на первый и последний день.
    mockUserRepo.getDailyRegistrations.mockResolvedValue([
      { date: dayKey(2), count: 5 },
      { date: dayKey(0), count: 3 },
    ]);

    const result = await useCase.execute(3);

    expect(result.series.map((p) => p.newUsers)).toEqual([5, 0, 3]);
    expect(result.series.map((p) => p.totalUsers)).toEqual([15, 15, 18]);
    expect(result.series[0]?.date).toBe(dayKey(2));
    expect(result.series[2]?.date).toBe(dayKey(0));
  });

  it('passes a since date exactly `days - 1` days before today to both repo calls', async () => {
    mockUserRepo.countCreatedBefore.mockResolvedValue(0);
    mockUserRepo.getDailyRegistrations.mockResolvedValue([]);

    await useCase.execute(30);

    const [sinceArg] = mockUserRepo.countCreatedBefore.mock.calls[0];
    const [sinceArg2] = mockUserRepo.getDailyRegistrations.mock.calls[0];
    expect(sinceArg.getTime()).toBe(sinceArg2.getTime());

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expectedSince = new Date(today);
    expectedSince.setDate(expectedSince.getDate() - 29);
    expect(sinceArg.getTime()).toBe(expectedSince.getTime());
  });
});
