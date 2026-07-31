import { ReferralRewardService } from '../../src/application/usecases/referral/ReferralRewardService';

const mockUserRepo = {
  findById: jest.fn(),
};

const mockSubscriptionRepo = {
  findActiveByUserId: jest.fn(),
};

const mockPlanRepo = {
  findById: jest.fn(),
};

let rewardIdCounter = 0;
const mockRewardRepo = {
  create: jest.fn(),
  update: jest.fn().mockResolvedValue(undefined),
  countCompletedConversionsSince: jest.fn().mockResolvedValue(0),
  countRewardsSince: jest.fn().mockResolvedValue(0),
  sumPendingDays: jest.fn().mockResolvedValue(0),
  sumGrantedTrafficGb: jest.fn().mockResolvedValue(0),
  countConvertedReferrals: jest.fn().mockResolvedValue(0),
};

const mockSettingsService = {
  get: jest.fn(),
};

const mockRemnawaveService = {
  getUserTrafficLimitBytes: jest.fn(),
  updateTrafficLimit: jest.fn().mockResolvedValue(undefined),
};

const mockRenewSubscriptionUseCase = {
  execute: jest.fn().mockResolvedValue({ endDate: new Date() }),
};

const mockNotificationService = {
  send: jest.fn().mockResolvedValue(true),
};

function baseSettings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    referredSignupBonusType: 'traffic_gb',
    referredSignupBonusDays: 5,
    referredSignupBonusTrafficGb: 3,
    referrerSignupRewardEnabled: true,
    referrerSignupRewardType: 'days',
    referrerSignupRewardDays: 2,
    referrerSignupRewardTrafficGb: 2,
    referrerSignupTrafficMaxStackedGb: 8,
    referrerSignupRewardTrafficFallbackDays: 1,
    referrerSignupRewardMaxPer7d: 5,
    conversionRewardMode: 'flat_days',
    conversionRewardFlatDays: 10,
    conversionRewardPercent: 20,
    conversionTrafficBonusEnabled: true,
    conversionTrafficBonusGb: 1,
    conversionTrafficBonusMaxStackedGb: 10,
    conversionTrafficBonusFallbackDays: 2,
    level2RewardPercent: 30,
    milestones: [{ convertedCount: 5, bonusDays: 15 }],
    maxRewardedConversionsPer30d: 20,
    maxBankedDays: 60,
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return { id: 'user-1', telegramId: 111, firstName: 'Vlad', referredByUserId: null, ...overrides } as never;
}

describe('ReferralRewardService', () => {
  let service: ReferralRewardService;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — mockResolvedValue set by one test must not leak
    // into the next test's default, only explicit "Once" mocks should be transient.
    jest.resetAllMocks();
    rewardIdCounter = 0;
    mockRewardRepo.create.mockImplementation(async (data: Record<string, unknown>) => ({
      id: `reward-${++rewardIdCounter}`,
      ...data,
    }));
    mockRewardRepo.update.mockResolvedValue(undefined);
    mockRewardRepo.countCompletedConversionsSince.mockResolvedValue(0);
    mockRewardRepo.countRewardsSince.mockResolvedValue(0);
    mockRewardRepo.sumPendingDays.mockResolvedValue(0);
    mockRewardRepo.sumGrantedTrafficGb.mockResolvedValue(0);
    mockRewardRepo.countConvertedReferrals.mockResolvedValue(0);
    mockRemnawaveService.updateTrafficLimit.mockResolvedValue(undefined);
    mockRenewSubscriptionUseCase.execute.mockResolvedValue({ endDate: new Date() });
    mockNotificationService.send.mockResolvedValue(true);
    mockSettingsService.get.mockResolvedValue(baseSettings());
    service = new ReferralRewardService(
      mockUserRepo as never,
      mockSubscriptionRepo as never,
      mockPlanRepo as never,
      mockRewardRepo as never,
      mockSettingsService as never,
      mockRemnawaveService as never,
      mockRenewSubscriptionUseCase as never,
      mockNotificationService as never,
    );
  });

  describe('getReferredSignupPerkAdjustment', () => {
    it('returns null when the user was not referred', async () => {
      expect(await service.getReferredSignupPerkAdjustment(null)).toBeNull();
    });

    it('returns null while the program is disabled', async () => {
      mockSettingsService.get.mockResolvedValue(baseSettings({ enabled: false }));
      expect(await service.getReferredSignupPerkAdjustment('referrer-1')).toBeNull();
    });

    it('returns the traffic bonus in traffic_gb mode', async () => {
      const adjustment = await service.getReferredSignupPerkAdjustment('referrer-1');
      expect(adjustment).toEqual({ extraDays: 0, extraTrafficGb: 3 });
    });

    it('returns the days bonus in days mode', async () => {
      mockSettingsService.get.mockResolvedValue(baseSettings({ referredSignupBonusType: 'days' }));
      const adjustment = await service.getReferredSignupPerkAdjustment('referrer-1');
      expect(adjustment).toEqual({ extraDays: 5, extraTrafficGb: 0 });
    });
  });

  describe('grantReferrerSignupReward', () => {
    it('extends the active subscription and notifies when the referrer has one', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-referrer' });
      mockUserRepo.findById.mockResolvedValue({ id: 'referrer-1', telegramId: 222 });

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRenewSubscriptionUseCase.execute).toHaveBeenCalledWith('sub-referrer', 2);
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rewardType: 'referrer_signup', status: 'granted', daysGranted: 2 }),
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'referral_signup_reward', telegramId: 222 }),
      );
    });

    it('banks the reward as pending_claim when the referrer has no active subscription', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
      mockUserRepo.findById.mockResolvedValue({ id: 'referrer-1', telegramId: 222 });

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRenewSubscriptionUseCase.execute).not.toHaveBeenCalled();
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending_claim', daysGranted: 2 }),
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'referral_pending_reward' }),
      );
    });

    it('marks the reward capped and applies nothing once the 7-day rate cap is hit', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockRewardRepo.countRewardsSince.mockResolvedValue(5); // == referrerSignupRewardMaxPer7d default
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-referrer' });

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRenewSubscriptionUseCase.execute).not.toHaveBeenCalled();
      expect(mockRewardRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'capped' }));
      expect(mockNotificationService.send).not.toHaveBeenCalled();
    });

    it('does nothing if the referred user was not actually referred', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: null });

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRewardRepo.create).not.toHaveBeenCalled();
    });

    it('is idempotent: a duplicate insert (unique violation) short-circuits before mutating anything', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-referrer' });
      mockRewardRepo.create.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: '23505' }));

      await service.grantReferrerSignupReward(referredUser);

      // Строка не создана (или уже создана ранее) — мутация подписки НЕ выполняется повторно.
      expect(mockRenewSubscriptionUseCase.execute).not.toHaveBeenCalled();
      expect(mockNotificationService.send).not.toHaveBeenCalled();
    });

    it('converts a traffic reward to fallback days when the referrer is already on an unlimited paid plan', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSettingsService.get.mockResolvedValue(baseSettings({ referrerSignupRewardType: 'traffic_gb' }));
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-referrer', planId: 'plan-paid' });
      mockPlanRepo.findById.mockResolvedValue({ id: 'plan-paid', type: 'paid' });
      mockUserRepo.findById.mockResolvedValue({ id: 'referrer-1', telegramId: 222 });

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRemnawaveService.updateTrafficLimit).not.toHaveBeenCalled();
      expect(mockRenewSubscriptionUseCase.execute).toHaveBeenCalledWith('sub-referrer', 1); // fallback days default
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { trafficConvertedToFallbackDays: 1 } }),
      );
    });

    it('applies traffic to Remnawave (current + delta) when the referrer is still on trial', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSettingsService.get.mockResolvedValue(baseSettings({ referrerSignupRewardType: 'traffic_gb' }));
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-referrer',
        planId: 'plan-trial',
        remnawaveUserId: 'rw-referrer',
      });
      mockPlanRepo.findById.mockResolvedValue({ id: 'plan-trial', type: 'trial' });
      mockRemnawaveService.getUserTrafficLimitBytes.mockResolvedValue(2 * 1024 * 1024 * 1024);

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRemnawaveService.updateTrafficLimit).toHaveBeenCalledWith(
        'rw-referrer',
        4 * 1024 * 1024 * 1024, // 2 GB current + 2 GB reward
      );
    });

    it('caps stacked traffic at the ceiling instead of granting the full amount', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSettingsService.get.mockResolvedValue(
        baseSettings({ referrerSignupRewardType: 'traffic_gb', referrerSignupTrafficMaxStackedGb: 3 }),
      );
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-referrer',
        planId: 'plan-trial',
        remnawaveUserId: 'rw-referrer',
      });
      mockPlanRepo.findById.mockResolvedValue({ id: 'plan-trial', type: 'trial' });
      mockRewardRepo.sumGrantedTrafficGb.mockResolvedValue(2); // already 2 of 3 GB used
      mockRemnawaveService.getUserTrafficLimitBytes.mockResolvedValue(0);

      await service.grantReferrerSignupReward(referredUser);

      // Хочет +2 ГБ, но осталось только 1 ГБ до потолка.
      expect(mockRemnawaveService.updateTrafficLimit).toHaveBeenCalledWith('rw-referrer', 1 * 1024 * 1024 * 1024);
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ trafficGbGranted: 1, metadata: { stackingCeilingReached: true } }),
      );
    });
  });

  describe('banked-days cap (§2.6)', () => {
    it('caps instead of banking once the pending-days total would exceed maxBankedDays', async () => {
      const referredUser = makeUser({ id: 'friend-1', referredByUserId: 'referrer-1' });
      mockSettingsService.get.mockResolvedValue(baseSettings({ maxBankedDays: 5 }));
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
      mockRewardRepo.sumPendingDays.mockResolvedValue(4); // 4 already banked, +2 more would be 6 > 5

      await service.grantReferrerSignupReward(referredUser);

      expect(mockRewardRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'capped' }));
      expect(mockNotificationService.send).not.toHaveBeenCalled();
    });
  });

  describe('processConversionRewards', () => {
    it('does nothing when the buyer was not referred', async () => {
      const buyer = makeUser({ referredByUserId: null });
      await service.processConversionRewards(buyer, 'pay-1', 30);
      expect(mockRewardRepo.create).not.toHaveBeenCalled();
    });

    it('grants flat days + traffic and sends one combined notification', async () => {
      const buyer = makeUser({ id: 'buyer-1', referredByUserId: 'referrer-1' });
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-referrer',
        planId: 'plan-trial',
        remnawaveUserId: 'rw-referrer',
      });
      mockPlanRepo.findById.mockResolvedValue({ id: 'plan-trial', type: 'trial' });
      mockRemnawaveService.getUserTrafficLimitBytes.mockResolvedValue(0);
      mockUserRepo.findById.mockResolvedValue({ id: 'referrer-1', telegramId: 222, referredByUserId: null });

      await service.processConversionRewards(buyer, 'pay-1', 30);

      expect(mockRenewSubscriptionUseCase.execute).toHaveBeenCalledWith('sub-referrer', 10);
      expect(mockRemnawaveService.updateTrafficLimit).toHaveBeenCalledWith('rw-referrer', 1 * 1024 * 1024 * 1024);
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rewardType: 'referrer_conversion_l1_days', triggerPaymentId: 'pay-1' }),
      );
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rewardType: 'referrer_conversion_l1_traffic', triggerPaymentId: 'pay-1' }),
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'referral_conversion_reward' }),
      );
    });

    it('marks the conversion capped once the 30-day conversion cap is reached, without granting anything', async () => {
      const buyer = makeUser({ id: 'buyer-1', referredByUserId: 'referrer-1' });
      mockRewardRepo.countCompletedConversionsSince.mockResolvedValue(20); // == default cap

      await service.processConversionRewards(buyer, 'pay-1', 30);

      expect(mockRenewSubscriptionUseCase.execute).not.toHaveBeenCalled();
      expect(mockRewardRepo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'capped' }));
    });

    it('grants a milestone bonus once the converted-count threshold is crossed', async () => {
      const buyer = makeUser({ id: 'buyer-1', referredByUserId: 'referrer-1' });
      mockSettingsService.get.mockResolvedValue(baseSettings({ conversionTrafficBonusEnabled: false }));
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-referrer' });
      mockRewardRepo.countConvertedReferrals.mockResolvedValue(5); // matches the configured milestone
      mockUserRepo.findById.mockResolvedValue({ id: 'referrer-1', telegramId: 222, referredByUserId: null });

      await service.processConversionRewards(buyer, 'pay-1', 30);

      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rewardType: 'milestone', daysGranted: 15, milestoneConvertedCountThreshold: 5 }),
      );
      expect(mockNotificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'referral_milestone_reward' }),
      );
    });

    it('grants a level-2 (pyramid) reward to the grandparent referrer', async () => {
      const buyer = makeUser({ id: 'buyer-1', referredByUserId: 'referrer-1' });
      mockSettingsService.get.mockResolvedValue(baseSettings({ conversionTrafficBonusEnabled: false }));
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({ id: 'sub-referrer' });
      mockUserRepo.findById.mockImplementation(async (id: string) => {
        if (id === 'referrer-1') return { id: 'referrer-1', telegramId: 222, firstName: 'Mid', referredByUserId: 'grandparent-1' };
        if (id === 'grandparent-1') return { id: 'grandparent-1', telegramId: 333, firstName: 'Grand' };
        return null;
      });

      await service.processConversionRewards(buyer, 'pay-1', 30);

      // 30% от 10 дней = 3
      expect(mockRewardRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rewardType: 'referrer_conversion_l2', referrerUserId: 'grandparent-1', daysGranted: 3, level: 2 }),
      );
    });
  });
});
