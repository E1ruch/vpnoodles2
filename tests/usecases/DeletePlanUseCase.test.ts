import { DeletePlanUseCase } from '../../src/application/usecases/DeletePlanUseCase';
import { PlanInUseError } from '../../src/shared/errors/index';

const mockPlanRepo = {
  delete: jest.fn(),
};

describe('DeletePlanUseCase', () => {
  let useCase: DeletePlanUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new DeletePlanUseCase(mockPlanRepo as never);
  });

  it('forwards id to the repository', async () => {
    mockPlanRepo.delete.mockResolvedValue(undefined);

    await useCase.execute('p1');

    expect(mockPlanRepo.delete).toHaveBeenCalledWith('p1');
  });

  it('propagates PlanInUseError from the repository', async () => {
    mockPlanRepo.delete.mockRejectedValue(new PlanInUseError('p1'));

    await expect(useCase.execute('p1')).rejects.toBeInstanceOf(PlanInUseError);
  });
});
