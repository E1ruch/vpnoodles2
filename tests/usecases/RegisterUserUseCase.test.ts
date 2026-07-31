import { RegisterUserUseCase } from '../../src/application/usecases/RegisterUserUseCase';

const mockUserRepo = {
  findByTelegramId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findByReferralCode: jest.fn(),
};

const mockAuditLogRepo = {
  create: jest.fn().mockResolvedValue({}),
};

const mockReferralSettings = {
  get: jest.fn(),
};

describe('RegisterUserUseCase', () => {
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReferralSettings.get.mockResolvedValue({ enabled: true });
    useCase = new RegisterUserUseCase(
      mockUserRepo as never,
      mockAuditLogRepo as never,
      mockReferralSettings as never,
    );
  });

  it('returns the existing id without creating a new user or attributing anything', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue({ id: 'existing-1' });

    const id = await useCase.execute(123, 'u', 'F', 'r_ABCDEF12');

    expect(id).toBe('existing-1');
    expect(mockUserRepo.create).not.toHaveBeenCalled();
    expect(mockUserRepo.findByReferralCode).not.toHaveBeenCalled();
  });

  it('registers a new user without attribution when there is no startPayload', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });

    const id = await useCase.execute(123, 'u', 'F', null);

    expect(id).toBe('new-1');
    expect(mockUserRepo.findByReferralCode).not.toHaveBeenCalled();
    expect(mockUserRepo.update).not.toHaveBeenCalled();
    expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user_registered' }),
    );
  });

  it('ignores a payload without the r_ prefix', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });

    await useCase.execute(123, 'u', 'F', 'some_other_payload');

    expect(mockUserRepo.findByReferralCode).not.toHaveBeenCalled();
  });

  it('attributes a new user to the referrer when the code resolves', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });
    mockUserRepo.findByReferralCode.mockResolvedValue({ id: 'referrer-1' });

    await useCase.execute(123, 'u', 'F', 'r_ABCDEF12');

    expect(mockUserRepo.findByReferralCode).toHaveBeenCalledWith('ABCDEF12');
    expect(mockUserRepo.update).toHaveBeenCalledWith('new-1', { referredByUserId: 'referrer-1' });
    expect(mockAuditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'new-1', action: 'referral_attributed', entityId: 'referrer-1' }),
    );
  });

  it('registers successfully but skips attribution for an unknown referral code', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });
    mockUserRepo.findByReferralCode.mockResolvedValue(null);

    const id = await useCase.execute(123, 'u', 'F', 'r_UNKNOWN1');

    expect(id).toBe('new-1');
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('never sets referredByUserId to the new user itself (self-referral guard)', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });
    mockUserRepo.findByReferralCode.mockResolvedValue({ id: 'new-1' });

    await useCase.execute(123, 'u', 'F', 'r_SELF0001');

    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('skips attribution entirely while the referral program is disabled', async () => {
    mockReferralSettings.get.mockResolvedValue({ enabled: false });
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });

    await useCase.execute(123, 'u', 'F', 'r_ABCDEF12');

    expect(mockUserRepo.findByReferralCode).not.toHaveBeenCalled();
    expect(mockUserRepo.update).not.toHaveBeenCalled();
  });

  it('still completes registration if referral attribution throws', async () => {
    mockUserRepo.findByTelegramId.mockResolvedValue(null);
    mockUserRepo.create.mockResolvedValue({ id: 'new-1' });
    mockReferralSettings.get.mockRejectedValue(new Error('redis down'));

    const id = await useCase.execute(123, 'u', 'F', 'r_ABCDEF12');

    expect(id).toBe('new-1');
  });
});
