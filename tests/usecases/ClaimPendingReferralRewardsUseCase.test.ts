import { ClaimPendingReferralRewardsUseCase } from '../../src/application/usecases/referral/ClaimPendingReferralRewardsUseCase';

const mockRewardRepo = {
  findPendingByReferrer: jest.fn(),
  markClaimed: jest.fn().mockResolvedValue(undefined),
};

const mockRenewSubscriptionUseCase = {
  execute: jest.fn(),
};

const mockReferralSettings = {
  get: jest.fn(),
};

describe('ClaimPendingReferralRewardsUseCase', () => {
  let useCase: ClaimPendingReferralRewardsUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReferralSettings.get.mockResolvedValue({ enabled: true });
    mockRenewSubscriptionUseCase.execute.mockResolvedValue({ endDate: new Date() });
    useCase = new ClaimPendingReferralRewardsUseCase(
      mockRewardRepo as never,
      mockRenewSubscriptionUseCase as never,
      mockReferralSettings as never,
    );
  });

  it('does nothing while the referral program is disabled — banked rewards stay frozen, not lost', async () => {
    mockReferralSettings.get.mockResolvedValue({ enabled: false });

    await useCase.execute('user-1', 'sub-1');

    expect(mockRewardRepo.findPendingByReferrer).not.toHaveBeenCalled();
  });

  it('does nothing when there is nothing pending', async () => {
    mockRewardRepo.findPendingByReferrer.mockResolvedValue([]);

    await useCase.execute('user-1', 'sub-1');

    expect(mockRenewSubscriptionUseCase.execute).not.toHaveBeenCalled();
    expect(mockRewardRepo.markClaimed).not.toHaveBeenCalled();
  });

  it('sums all pending days, applies them once, and marks every row claimed', async () => {
    mockRewardRepo.findPendingByReferrer.mockResolvedValue([
      { id: 'r1', daysGranted: 10 },
      { id: 'r2', daysGranted: 3 },
    ]);

    await useCase.execute('user-1', 'sub-1');

    expect(mockRenewSubscriptionUseCase.execute).toHaveBeenCalledWith('sub-1', 13);
    expect(mockRewardRepo.markClaimed).toHaveBeenCalledWith(['r1', 'r2'], 'sub-1');
  });

  it('marks zero-day rows claimed without touching the subscription', async () => {
    mockRewardRepo.findPendingByReferrer.mockResolvedValue([{ id: 'r1', daysGranted: 0 }]);

    await useCase.execute('user-1', 'sub-1');

    expect(mockRenewSubscriptionUseCase.execute).not.toHaveBeenCalled();
    expect(mockRewardRepo.markClaimed).toHaveBeenCalledWith(['r1'], 'sub-1');
  });

  it('leaves rewards pending (does not mark claimed) if applying the days fails', async () => {
    mockRewardRepo.findPendingByReferrer.mockResolvedValue([{ id: 'r1', daysGranted: 5 }]);
    mockRenewSubscriptionUseCase.execute.mockRejectedValue(new Error('remnawave down'));

    await expect(useCase.execute('user-1', 'sub-1')).resolves.not.toThrow();

    expect(mockRewardRepo.markClaimed).not.toHaveBeenCalled();
  });
});
