import { DeleteServerCostUseCase } from '../../src/application/usecases/DeleteServerCostUseCase';

const mockServerCostRepo = {
  deleteByNodeUuid: jest.fn(),
};

describe('DeleteServerCostUseCase', () => {
  let useCase: DeleteServerCostUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new DeleteServerCostUseCase(mockServerCostRepo as never);
  });

  it('forwards nodeUuid to the repository', async () => {
    mockServerCostRepo.deleteByNodeUuid.mockResolvedValue(undefined);

    await useCase.execute('node-1');

    expect(mockServerCostRepo.deleteByNodeUuid).toHaveBeenCalledWith('node-1');
  });
});
