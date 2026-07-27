import { DeactivateBlockedUserUseCase } from '../../src/application/usecases/DeactivateBlockedUserUseCase';

const mockUserRepo = {
  findById: jest.fn(),
  update: jest.fn(),
};

const mockSubscriptionRepo = {
  findActiveByUserId: jest.fn(),
};

const mockAuditLogRepo = {
  create: jest.fn().mockResolvedValue({}),
};

const mockRemnawaveService = {
  suspendUser: jest.fn().mockResolvedValue(undefined),
};

describe('DeactivateBlockedUserUseCase', () => {
  let useCase: DeactivateBlockedUserUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRemnawaveService.suspendUser.mockResolvedValue(undefined);
    useCase = new DeactivateBlockedUserUseCase(
      mockUserRepo as never,
      mockSubscriptionRepo as never,
      mockAuditLogRepo as never,
      mockRemnawaveService as never,
    );
  });

  it('marks the user inactive and suspends Remnawave when there is an active subscription', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u1', isActive: true });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: 'rw-1' });

    await useCase.execute('u1');

    expect(mockUserRepo.update).toHaveBeenCalledWith('u1', { isActive: false });
    expect(mockRemnawaveService.suspendUser).toHaveBeenCalledWith('rw-1');
    expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: 'user_blocked_bot' }),
    );
  });

  it('marks the user inactive without touching Remnawave when there is no active subscription', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u2', isActive: true });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);

    await useCase.execute('u2');

    expect(mockUserRepo.update).toHaveBeenCalledWith('u2', { isActive: false });
    expect(mockRemnawaveService.suspendUser).not.toHaveBeenCalled();
    expect(mockAuditLogRepo.create).toHaveBeenCalled();
  });

  it('is idempotent: does nothing for an already inactive user', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u3', isActive: false });

    await useCase.execute('u3');

    expect(mockUserRepo.update).not.toHaveBeenCalled();
    expect(mockSubscriptionRepo.findActiveByUserId).not.toHaveBeenCalled();
    expect(mockAuditLogRepo.create).not.toHaveBeenCalled();
  });

  it('still marks the user inactive and logs even if suspending in Remnawave fails', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u4', isActive: true });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-4', remnawaveUserId: 'rw-4' });
    mockRemnawaveService.suspendUser.mockRejectedValue(new Error('panel down'));

    await expect(useCase.execute('u4')).resolves.not.toThrow();

    expect(mockUserRepo.update).toHaveBeenCalledWith('u4', { isActive: false });
    expect(mockAuditLogRepo.create).toHaveBeenCalled();
  });

  it('does nothing for a non-existent user', async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    await useCase.execute('missing');

    expect(mockUserRepo.update).not.toHaveBeenCalled();
    expect(mockAuditLogRepo.create).not.toHaveBeenCalled();
  });
});
