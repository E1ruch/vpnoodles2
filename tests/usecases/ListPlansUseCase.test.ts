import { ListPlansUseCase } from '../../src/application/usecases/ListPlansUseCase';

const mockPlanRepo = {
  findAll: jest.fn(),
};
const mockSubscriptionRepo = {
  countActiveByPlan: jest.fn(),
};

describe('ListPlansUseCase', () => {
  let useCase: ListPlansUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListPlansUseCase(mockPlanRepo as never, mockSubscriptionRepo as never);
  });

  it('merges plans with their active subscription counts', async () => {
    mockPlanRepo.findAll.mockResolvedValue([
      { id: 'p1', name: 'Trial' },
      { id: 'p2', name: 'Paid' },
    ]);
    mockSubscriptionRepo.countActiveByPlan.mockResolvedValue([{ planId: 'p1', count: 5 }]);

    const result = await useCase.execute();

    expect(result).toEqual([
      { id: 'p1', name: 'Trial', activeSubscriptionsCount: 5 },
      { id: 'p2', name: 'Paid', activeSubscriptionsCount: 0 },
    ]);
  });
});
