import { ActivateTrialUseCase } from '../../src/application/usecases/ActivateTrialUseCase';
import { SubscriptionError, ValidationError } from '../../src/shared/errors/index';

// Mock repositories
const mockUserRepo = {
  findById: jest.fn(),
  findByTelegramId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockPlanRepo = {
  findById: jest.fn(),
  findByType: jest.fn(),
  findActive: jest.fn(),
  create: jest.fn(),
};

const mockSubscriptionRepo = {
  findById: jest.fn(),
  findActiveByUserId: jest.fn(),
  findByUserId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findExpiringSoon: jest.fn(),
  findActiveExpiringWithinDays: jest.fn(),
};

const mockAuditLogRepo = {
  create: jest.fn(),
  findByUserId: jest.fn(),
};

const mockRemnawaveService = {
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  suspendUser: jest.fn(),
  resumeUser: jest.fn(),
  getSubscriptionUrl: jest.fn(),
  updateDeviceLimit: jest.fn(),
  extendUser: jest.fn(),
  getHwidDeviceTotal: jest.fn().mockResolvedValue(0),
};

const mockSyncSubscriptionDevices = {
  execute: jest.fn().mockResolvedValue(undefined),
};

describe('ActivateTrialUseCase', () => {
  let useCase: ActivateTrialUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ActivateTrialUseCase(
      mockUserRepo as never,
      mockPlanRepo as never,
      mockSubscriptionRepo as never,
      mockAuditLogRepo as never,
      mockRemnawaveService as never,
      mockSyncSubscriptionDevices as never,
    );
  });

  it('should throw ValidationError if user not found', async () => {
    mockUserRepo.findById.mockResolvedValue(null);
    await expect(useCase.execute('nonexistent-id')).rejects.toThrow(ValidationError);
  });

  it('should throw SubscriptionError if trial already exists', async () => {
    const trialPlan = {
      id: 'plan-trial',
      name: 'Бесплатный',
      type: 'trial',
      durationDays: 3,
      deviceLimit: 1,
    };
    mockUserRepo.findById.mockResolvedValue({
      id: 'user-1',
      telegramId: 123,
      hasUsedTrial: false,
    });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockPlanRepo.findByType.mockResolvedValue([trialPlan]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([{ planId: 'plan-trial' }]);

    await expect(useCase.execute('user-1')).rejects.toThrow(SubscriptionError);
  });

  it('should throw SubscriptionError if user has active subscription', async () => {
    const trialPlan = {
      id: 'plan-trial',
      name: 'Бесплатный',
      type: 'trial',
      durationDays: 3,
      deviceLimit: 1,
    };
    mockUserRepo.findById.mockResolvedValue({
      id: 'user-1',
      telegramId: 123,
      hasUsedTrial: false,
    });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-1' });
    mockPlanRepo.findByType.mockResolvedValue([trialPlan]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);

    await expect(useCase.execute('user-1')).rejects.toThrow(SubscriptionError);
  });

  it('should throw ValidationError if trial plan not found', async () => {
    mockUserRepo.findById.mockResolvedValue({
      id: 'user-1',
      telegramId: 123,
      hasUsedTrial: false,
    });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockPlanRepo.findByType.mockResolvedValue([]);

    await expect(useCase.execute('user-1')).rejects.toThrow(ValidationError);
  });

  it('should activate trial successfully', async () => {
    const mockUser = {
      id: 'user-1',
      telegramId: 123,
      username: 'testuser',
      hasUsedTrial: false,
    };
    const mockPlan = {
      id: 'plan-trial',
      name: 'Бесплатный',
      type: 'trial',
      durationDays: 3,
      deviceLimit: 1,
    };

    mockUserRepo.findById.mockResolvedValue(mockUser);
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockPlanRepo.findByType.mockResolvedValue([mockPlan]);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
    mockRemnawaveService.createUser.mockResolvedValue('remnawave-user-1');
    mockRemnawaveService.getSubscriptionUrl.mockResolvedValue('https://sub.example.com/test');
    mockSubscriptionRepo.create.mockResolvedValue({
      id: 'sub-1',
      userId: 'user-1',
      planId: 'plan-trial',
      status: 'active',
    });
    mockSubscriptionRepo.update.mockResolvedValue({
      id: 'sub-1',
      subscriptionUrl: 'https://sub.example.com/test',
    });
    mockAuditLogRepo.create.mockResolvedValue({});

    const result = await useCase.execute('user-1');

    expect(result.subscriptionId).toBe('sub-1');
    expect(result.subscriptionUrl).toBe('https://sub.example.com/test');
    expect(mockRemnawaveService.createUser).toHaveBeenCalledWith(
      123,
      'testuser',
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ deviceLimit: mockPlan.deviceLimit }),
    );
    expect(mockSyncSubscriptionDevices.execute).toHaveBeenCalledWith('sub-1');
  });
});
