import { UpsertServerCostUseCase } from '../../src/application/usecases/UpsertServerCostUseCase';

const mockServerCostRepo = {
  upsert: jest.fn(),
};

describe('UpsertServerCostUseCase', () => {
  let useCase: UpsertServerCostUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new UpsertServerCostUseCase(mockServerCostRepo as never);
  });

  it('forwards nodeUuid and data to the repository', async () => {
    const data = { monthlyCostRub: 1500, nextPaymentDate: null, note: 'Hetzner', nodeName: 'Frankfurt-1' };
    const saved = { id: '1', nodeUuid: 'node-1', ...data };
    mockServerCostRepo.upsert.mockResolvedValue(saved);

    const result = await useCase.execute('node-1', data);

    expect(result).toBe(saved);
    expect(mockServerCostRepo.upsert).toHaveBeenCalledWith('node-1', data);
  });
});
