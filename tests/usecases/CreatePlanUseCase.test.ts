import { CreatePlanUseCase } from '../../src/application/usecases/CreatePlanUseCase';

const mockPlanRepo = {
  create: jest.fn(),
};

describe('CreatePlanUseCase', () => {
  let useCase: CreatePlanUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new CreatePlanUseCase(mockPlanRepo as never);
  });

  it('forwards the input to the repository', async () => {
    const input = {
      name: 'Pro',
      type: 'paid' as const,
      durationDays: 30,
      deviceLimit: 3,
      priceStars: 500,
      priceRub: 299,
      isActive: true,
      sortOrder: 1,
      remnawaveTag: 'pro',
      description: null,
    };
    const saved = { id: 'p1', ...input };
    mockPlanRepo.create.mockResolvedValue(saved);

    const result = await useCase.execute(input);

    expect(result).toBe(saved);
    expect(mockPlanRepo.create).toHaveBeenCalledWith(input);
  });
});
