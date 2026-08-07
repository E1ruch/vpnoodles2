import { ListServerCostsUseCase } from '../../src/application/usecases/ListServerCostsUseCase';

const mockServerCostRepo = {
  findAll: jest.fn(),
};

describe('ListServerCostsUseCase', () => {
  let useCase: ListServerCostsUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListServerCostsUseCase(mockServerCostRepo as never);
  });

  it('returns all server cost rows from the repository', async () => {
    const rows = [{ id: '1', nodeUuid: 'node-1', monthlyCostRub: 1000 }];
    mockServerCostRepo.findAll.mockResolvedValue(rows);

    const result = await useCase.execute();

    expect(result).toBe(rows);
    expect(mockServerCostRepo.findAll).toHaveBeenCalledTimes(1);
  });
});
