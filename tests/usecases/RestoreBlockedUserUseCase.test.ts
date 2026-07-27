import { RestoreBlockedUserUseCase } from '../../src/application/usecases/RestoreBlockedUserUseCase';
import { ValidationError } from '../../src/shared/errors/index';

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
  resumeUser: jest.fn().mockResolvedValue(undefined),
};

describe('RestoreBlockedUserUseCase', () => {
  let useCase: RestoreBlockedUserUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRemnawaveService.resumeUser.mockResolvedValue(undefined);
    useCase = new RestoreBlockedUserUseCase(
      mockUserRepo as never,
      mockSubscriptionRepo as never,
      mockAuditLogRepo as never,
      mockRemnawaveService as never,
    );
  });

  it('reactivates the user and resumes Remnawave when there is an active subscription', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u1', isActive: false });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1', remnawaveUserId: 'rw-1' });

    await useCase.execute('u1');

    expect(mockUserRepo.update).toHaveBeenCalledWith('u1', { isActive: true });
    expect(mockRemnawaveService.resumeUser).toHaveBeenCalledWith('rw-1');
    expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', action: 'user_restored_access' }),
    );
  });

  it('reactivates the user without touching Remnawave when there is no active subscription', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u2', isActive: false });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);

    await useCase.execute('u2');

    expect(mockUserRepo.update).toHaveBeenCalledWith('u2', { isActive: true });
    expect(mockRemnawaveService.resumeUser).not.toHaveBeenCalled();
  });

  it('is idempotent: does nothing for an already active user', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u3', isActive: true });

    await useCase.execute('u3');

    expect(mockUserRepo.update).not.toHaveBeenCalled();
    expect(mockSubscriptionRepo.findActiveByUserId).not.toHaveBeenCalled();
    expect(mockAuditLogRepo.create).not.toHaveBeenCalled();
  });

  it('still reactivates the user even if resuming in Remnawave fails', async () => {
    mockUserRepo.findById.mockResolvedValue({ id: 'u4', isActive: false });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-4', remnawaveUserId: 'rw-4' });
    mockRemnawaveService.resumeUser.mockRejectedValue(new Error('panel down'));

    await expect(useCase.execute('u4')).resolves.not.toThrow();

    expect(mockUserRepo.update).toHaveBeenCalledWith('u4', { isActive: true });
    expect(mockAuditLogRepo.create).toHaveBeenCalled();
  });

  it('throws ValidationError for a non-existent user', async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing')).rejects.toThrow(ValidationError);
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });
});
