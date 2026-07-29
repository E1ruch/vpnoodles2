import { ListNotificationLogsUseCase } from '../../src/application/usecases/ListNotificationLogsUseCase';

const mockNotificationLogRepo = {
  findAll: jest.fn(),
  countAll: jest.fn(),
};
const mockUserRepo = {
  findByIds: jest.fn(),
};

describe('ListNotificationLogsUseCase', () => {
  let useCase: ListNotificationLogsUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListNotificationLogsUseCase(mockNotificationLogRepo as never, mockUserRepo as never);
  });

  it('batch-resolves user labels and forwards type/pagination to the repo', async () => {
    mockNotificationLogRepo.findAll.mockResolvedValue([
      {
        id: 'n1',
        userId: 'u1',
        type: 'trial_expiring_2d',
        delivered: true,
        errorMessage: null,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'n2',
        userId: 'u2',
        type: 'trial_expiring_2d',
        delivered: false,
        errorMessage: 'blocked',
        createdAt: new Date('2026-01-02'),
      },
    ]);
    mockNotificationLogRepo.countAll.mockResolvedValue(2);
    mockUserRepo.findByIds.mockResolvedValue([{ id: 'u1', username: 'alice', firstName: 'Alice' }]);

    const result = await useCase.execute({ type: 'trial_expiring_2d', page: 0, pageSize: 20 });

    expect(mockNotificationLogRepo.findAll).toHaveBeenCalledWith({
      type: 'trial_expiring_2d',
      skip: 0,
      limit: 20,
      order: { createdAt: 'DESC' },
    });
    expect(mockNotificationLogRepo.countAll).toHaveBeenCalledWith({ type: 'trial_expiring_2d' });
    expect(mockUserRepo.findByIds).toHaveBeenCalledWith(['u1', 'u2']);
    expect(result.items).toEqual([
      {
        id: 'n1',
        userId: 'u1',
        userLabel: '@alice',
        type: 'trial_expiring_2d',
        delivered: true,
        errorMessage: null,
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'n2',
        userId: 'u2',
        userLabel: 'u2',
        type: 'trial_expiring_2d',
        delivered: false,
        errorMessage: 'blocked',
        createdAt: new Date('2026-01-02'),
      },
    ]);
    expect(result.total).toBe(2);
  });
});
