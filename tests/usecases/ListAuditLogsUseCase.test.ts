import { ListAuditLogsUseCase } from '../../src/application/usecases/ListAuditLogsUseCase';

const mockAuditLogRepo = {
  findAll: jest.fn(),
  count: jest.fn(),
};
const mockUserRepo = {
  findByIds: jest.fn(),
};

describe('ListAuditLogsUseCase', () => {
  let useCase: ListAuditLogsUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListAuditLogsUseCase(mockAuditLogRepo as never, mockUserRepo as never);
  });

  it('batch-resolves user labels and forwards pagination to the repo', async () => {
    mockAuditLogRepo.findAll.mockResolvedValue([
      {
        id: 'l1',
        userId: 'u1',
        action: 'trial_activated',
        entityType: 'subscription',
        entityId: 's1',
        metadata: { planId: 'plan-trial' },
        createdAt: new Date('2026-01-01'),
      },
    ]);
    mockAuditLogRepo.count.mockResolvedValue(1);
    mockUserRepo.findByIds.mockResolvedValue([{ id: 'u1', username: null, firstName: 'Alice' }]);

    const result = await useCase.execute({ page: 0, pageSize: 20 });

    expect(mockAuditLogRepo.findAll).toHaveBeenCalledWith({ skip: 0, limit: 20, order: { createdAt: 'DESC' } });
    expect(mockUserRepo.findByIds).toHaveBeenCalledWith(['u1']);
    expect(result.items).toEqual([
      {
        id: 'l1',
        userId: 'u1',
        userLabel: 'Alice',
        action: 'trial_activated',
        entityType: 'subscription',
        entityId: 's1',
        metadata: { planId: 'plan-trial' },
        createdAt: new Date('2026-01-01'),
      },
    ]);
    expect(result.total).toBe(1);
  });

  it('falls back to the raw userId when the user cannot be resolved (deleted user)', async () => {
    mockAuditLogRepo.findAll.mockResolvedValue([
      { id: 'l1', userId: 'ghost', action: 'user_registered', entityType: null, entityId: null, createdAt: new Date() },
    ]);
    mockAuditLogRepo.count.mockResolvedValue(1);
    mockUserRepo.findByIds.mockResolvedValue([]);

    const result = await useCase.execute({ page: 0, pageSize: 20 });

    expect(result.items[0]?.userLabel).toBe('ghost');
  });
});
