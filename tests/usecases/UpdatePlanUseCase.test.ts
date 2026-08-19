import { UpdatePlanUseCase } from '../../src/application/usecases/UpdatePlanUseCase';

const mockPlanRepo = {
  update: jest.fn(),
};

describe('UpdatePlanUseCase', () => {
  let useCase: UpdatePlanUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new UpdatePlanUseCase(mockPlanRepo as never);
  });

  it('forwards id and partial data to the repository', async () => {
    const data = { priceRub: 349, isActive: false };
    const saved = { id: 'p1', name: 'Pro', ...data };
    mockPlanRepo.update.mockResolvedValue(saved);

    const result = await useCase.execute('p1', data);

    expect(result).toBe(saved);
    expect(mockPlanRepo.update).toHaveBeenCalledWith('p1', data);
  });
});
