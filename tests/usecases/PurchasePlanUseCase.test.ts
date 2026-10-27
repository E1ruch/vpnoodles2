import { PurchasePlanUseCase } from '../../src/application/usecases/PurchasePlanUseCase';
import { PaymentLockedError } from '../../src/shared/errors/index';
import * as envModule from '../../src/shared/config/env';

// Регрессионные тесты на фикс гонки: YooKassa webhook и polling-тик (или два
// перекрывшихся тика) могли одновременно вызвать execute() для одного и того же
// платежа и оба продлить подписку в Remnawave (extendUser не идемпотентен).
// Теперь execute() берёт distributed-лок на paymentId перед фулфилментом.

const mockUserRepo = {
  findById: jest.fn(),
  findByTelegramId: jest.fn(),
};

const mockPlanRepo = {
  findById: jest.fn(),
};

const mockSubscriptionRepo = {
  findActiveByUserId: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
};

const mockPaymentRepo = {
  findById: jest.fn(),
  update: jest.fn().mockResolvedValue({}),
  countCompletedByUserId: jest.fn().mockResolvedValue(0),
};

const mockAuditLogRepo = {
  create: jest.fn().mockResolvedValue({}),
};

const mockRemnawaveService = {
  createUser: jest.fn(),
  upgradeUser: jest.fn(),
  extendUser: jest.fn(),
  updateUserTag: jest.fn(),
  updateDeviceLimit: jest.fn(),
  getUserExpireAt: jest.fn(),
  getSubscriptionUrl: jest.fn(),
  addUserSquads: jest.fn(),
};

const mockPaymentService = {
  createPayment: jest.fn(),
  markAsCompleted: jest.fn(),
  acquireFulfillmentLock: jest.fn(),
  releaseFulfillmentLock: jest.fn(),
};

const mockQrCodeService = {
  generateBase64: jest.fn().mockResolvedValue('data:image/png;base64,xxx'),
};

const mockSyncSubscriptionDevices = {
  execute: jest.fn().mockResolvedValue(undefined),
};

const mockReferralRewardService = {
  processConversionRewards: jest.fn().mockResolvedValue(undefined),
};

const mockClaimPendingReferralRewards = {
  execute: jest.fn().mockResolvedValue(undefined),
};

describe('PurchasePlanUseCase — fulfillment lock', () => {
  let useCase: PurchasePlanUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPaymentRepo.countCompletedByUserId.mockResolvedValue(0);
    mockPaymentRepo.update.mockResolvedValue({});
    useCase = new PurchasePlanUseCase(
      mockUserRepo as never,
      mockPlanRepo as never,
      mockSubscriptionRepo as never,
      mockPaymentRepo as never,
      mockAuditLogRepo as never,
      mockRemnawaveService as never,
      mockPaymentService as never,
      mockQrCodeService as never,
      mockSyncSubscriptionDevices as never,
      mockReferralRewardService as never,
      mockClaimPendingReferralRewards as never,
    );
  });

  it('throws PaymentLockedError and never touches Remnawave when the lock is held elsewhere', async () => {
    mockPaymentService.acquireFulfillmentLock.mockResolvedValue(false);

    await expect(
      useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' }),
    ).rejects.toThrow(PaymentLockedError);

    // Ключевая проверка: если лок не достался, до Remnawave вообще не доходим —
    // именно это предотвращает задвоенное продление подписки.
    expect(mockRemnawaveService.extendUser).not.toHaveBeenCalled();
    expect(mockRemnawaveService.upgradeUser).not.toHaveBeenCalled();
    expect(mockRemnawaveService.createUser).not.toHaveBeenCalled();
    expect(mockUserRepo.findById).not.toHaveBeenCalled();
    expect(mockPaymentService.releaseFulfillmentLock).not.toHaveBeenCalled();
  });

  it('acquires the lock, runs the purchase, then releases the lock on success', async () => {
    mockPaymentService.acquireFulfillmentLock.mockResolvedValue(true);
    mockUserRepo.findById.mockResolvedValue({ id: 'user-1', telegramId: 123, username: 'u' });
    mockPlanRepo.findById.mockResolvedValue({
      id: 'plan-1',
      type: 'paid',
      durationDays: 30,
      deviceLimit: 3,
      priceRub: 199,
      priceStars: 0,
    });
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
    mockPaymentRepo.findById.mockResolvedValue({
      id: 'pay-1',
      userId: 'user-1',
      planId: 'plan-1',
      provider: 'yookassa',
      status: 'pending',
      externalPaymentId: null,
    });
    mockRemnawaveService.createUser.mockResolvedValue('rw-1');
    mockRemnawaveService.upgradeUser.mockResolvedValue(undefined);
    mockRemnawaveService.getSubscriptionUrl.mockResolvedValue('https://sub.example.com/x');
    mockSubscriptionRepo.create.mockResolvedValue({ id: 'sub-1' });
    mockSubscriptionRepo.update.mockResolvedValue({});
    mockPaymentService.markAsCompleted.mockResolvedValue({});

    const result = await useCase.execute('user-1', 'plan-1', 'yookassa', {
      existingPaymentId: 'pay-1',
      externalChargeId: 'yk-charge-1',
    });

    expect(result.subscriptionId).toBe('sub-1');
    expect(mockPaymentService.acquireFulfillmentLock).toHaveBeenCalledWith('pay-1');
    expect(mockPaymentService.releaseFulfillmentLock).toHaveBeenCalledWith('pay-1');
    // Лок должен освобождаться уже после того, как продление/создание в Remnawave отработало.
    const createUserOrder = mockRemnawaveService.createUser.mock.invocationCallOrder[0] as number;
    const releaseLockOrder = mockPaymentService.releaseFulfillmentLock.mock
      .invocationCallOrder[0] as number;
    expect(createUserOrder).toBeLessThan(releaseLockOrder);
  });

  it('still releases the lock when the purchase fails partway through', async () => {
    mockPaymentService.acquireFulfillmentLock.mockResolvedValue(true);
    mockUserRepo.findById.mockResolvedValue({ id: 'user-1', telegramId: 123, username: 'u' });
    mockPlanRepo.findById.mockResolvedValue(null); // -> ValidationError('Plan not found')

    await expect(
      useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' }),
    ).rejects.toThrow('Plan not found');

    expect(mockPaymentService.releaseFulfillmentLock).toHaveBeenCalledWith('pay-1');
  });

  // Регрессионные тесты на фикс задвоения дней подписки: если фулфилмент падает
  // ПОСЛЕ успешной мутации в Remnawave, но ДО markAsCompleted (например, на записи
  // подписки/QR/audit log), retry не должен повторно вызывать extendUser/upgradeUser/
  // createUser — иначе дни подписки задваиваются (extendUser не идемпотентен).
  describe('idempotency of the Remnawave mutation across retries', () => {
    beforeEach(() => {
      mockPaymentService.acquireFulfillmentLock.mockResolvedValue(true);
      mockUserRepo.findById.mockResolvedValue({ id: 'user-1', telegramId: 123, username: 'u' });
      mockPlanRepo.findById.mockResolvedValue({
        id: 'plan-1',
        type: 'paid',
        durationDays: 30,
        deviceLimit: 3,
        priceRub: 199,
        priceStars: 0,
      });
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
      mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
      mockRemnawaveService.createUser.mockResolvedValue('rw-1');
      mockRemnawaveService.upgradeUser.mockResolvedValue(undefined);
      mockRemnawaveService.getSubscriptionUrl.mockResolvedValue('https://sub.example.com/x');
      mockSubscriptionRepo.create.mockResolvedValue({ id: 'sub-1' });
      mockSubscriptionRepo.update.mockResolvedValue({});
      mockPaymentService.markAsCompleted.mockResolvedValue({});
    });

    it('persists remnawaveUserId on the payment right after the Remnawave mutation succeeds', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        id: 'pay-1',
        userId: 'user-1',
        planId: 'plan-1',
        provider: 'yookassa',
        status: 'pending',
        externalPaymentId: null,
        remnawaveUserId: null,
      });

      await useCase.execute('user-1', 'plan-1', 'yookassa', {
        existingPaymentId: 'pay-1',
        externalChargeId: 'yk-charge-1',
      });

      expect(mockRemnawaveService.createUser).toHaveBeenCalledTimes(1);
      expect(mockPaymentRepo.update).toHaveBeenCalledWith('pay-1', { remnawaveUserId: 'rw-1' });

      // Записываем результат мутации до того, как продолжаем фулфилмент дальше.
      const updateOrder = mockPaymentRepo.update.mock.invocationCallOrder[0] as number;
      const markCompletedOrder = mockPaymentService.markAsCompleted.mock
        .invocationCallOrder[0] as number;
      expect(updateOrder).toBeLessThan(markCompletedOrder);
    });

    it('skips the Remnawave mutation entirely on retry when remnawaveUserId is already set', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        id: 'pay-1',
        userId: 'user-1',
        planId: 'plan-1',
        provider: 'yookassa',
        status: 'pending', // предыдущая попытка упала до markAsCompleted
        externalPaymentId: null,
        remnawaveUserId: 'rw-1', // но мутация в Remnawave уже была применена
      });

      const result = await useCase.execute('user-1', 'plan-1', 'yookassa', {
        existingPaymentId: 'pay-1',
        externalChargeId: 'yk-charge-1',
      });

      expect(mockRemnawaveService.createUser).not.toHaveBeenCalled();
      expect(mockRemnawaveService.upgradeUser).not.toHaveBeenCalled();
      expect(mockRemnawaveService.extendUser).not.toHaveBeenCalled();
      // Мутация уже применена — незачем перезаписывать то же самое значение снова.
      expect(mockPaymentRepo.update).not.toHaveBeenCalled();

      // Остальной (идемпотентный) хвост фулфилмента всё равно должен отработать.
      expect(result.subscriptionId).toBe('sub-1');
      expect(mockPaymentService.markAsCompleted).toHaveBeenCalledWith('pay-1', 'yk-charge-1');
    });
  });

  // Платный squad (CDN): выдаётся поверх дефолтного только при оплате и только если
  // REMNAWAVE_PAID_SQUAD задан. Не задан — поведение как раньше, squads не трогаем.
  describe('paid squad (REMNAWAVE_PAID_SQUAD)', () => {
    const realEnv = envModule.getEnv();
    let getEnvSpy: jest.SpyInstance;

    function setSquadEnv(defaultSquad: string, paidSquad: string) {
      getEnvSpy.mockReturnValue({
        ...realEnv,
        REMNAWAVE_DEFAULT_SQUAD: defaultSquad,
        REMNAWAVE_PAID_SQUAD: paidSquad,
      });
    }

    function pendingPayment(remnawaveUserId: string | null = null) {
      return {
        id: 'pay-1',
        userId: 'user-1',
        planId: 'plan-1',
        provider: 'yookassa',
        status: 'pending',
        externalPaymentId: null,
        remnawaveUserId,
      };
    }

    beforeEach(() => {
      getEnvSpy = jest.spyOn(envModule, 'getEnv');
      mockPaymentService.acquireFulfillmentLock.mockResolvedValue(true);
      mockUserRepo.findById.mockResolvedValue({ id: 'user-1', telegramId: 123, username: 'u' });
      mockPlanRepo.findById.mockResolvedValue({
        id: 'plan-1',
        type: 'paid',
        durationDays: 30,
        deviceLimit: 3,
        priceRub: 199,
        priceStars: 0,
      });
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
      mockSubscriptionRepo.findByUserId.mockResolvedValue([]);
      mockRemnawaveService.createUser.mockResolvedValue('rw-1');
      mockRemnawaveService.upgradeUser.mockResolvedValue(undefined);
      mockRemnawaveService.addUserSquads.mockResolvedValue(undefined);
      mockRemnawaveService.getSubscriptionUrl.mockResolvedValue('https://sub.example.com/x');
      mockSubscriptionRepo.create.mockResolvedValue({ id: 'sub-1' });
      mockSubscriptionRepo.update.mockResolvedValue({});
      mockPaymentService.markAsCompleted.mockResolvedValue({});
      mockPaymentRepo.findById.mockResolvedValue(pendingPayment());
    });

    afterEach(() => {
      getEnvSpy.mockRestore();
    });

    it('does not touch squads when REMNAWAVE_PAID_SQUAD is not set', async () => {
      setSquadEnv('squad-default', '');

      await useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' });

      expect(mockRemnawaveService.addUserSquads).not.toHaveBeenCalled();
      // createUser по-прежнему получает только дефолтный squad.
      expect(mockRemnawaveService.createUser.mock.calls[0][3]).toEqual(['squad-default']);
    });

    it('adds default + paid squads to a new paid user, after remnawaveUserId is persisted', async () => {
      setSquadEnv('squad-default', 'squad-cdn');

      await useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' });

      expect(mockRemnawaveService.addUserSquads).toHaveBeenCalledWith('rw-1', [
        'squad-default',
        'squad-cdn',
      ]);
      // Сбой addUserSquads до фиксации remnawaveUserId привёл бы к повторному
      // (неидемпотентному) продлению на retry — поэтому он строго после.
      const persistOrder = mockPaymentRepo.update.mock.invocationCallOrder[0] as number;
      const squadOrder = mockRemnawaveService.addUserSquads.mock.invocationCallOrder[0] as number;
      expect(persistOrder).toBeLessThan(squadOrder);
    });

    it('adds only the paid squad when no default squad is configured', async () => {
      setSquadEnv('', 'squad-cdn');

      await useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' });

      expect(mockRemnawaveService.addUserSquads).toHaveBeenCalledWith('rw-1', ['squad-cdn']);
    });

    it('adds the paid squad when upgrading a trial subscription', async () => {
      setSquadEnv('squad-default', 'squad-cdn');
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-trial',
        planId: 'plan-trial',
        remnawaveUserId: 'rw-trial',
        endDate: new Date(Date.now() + 86400000),
      });
      mockPlanRepo.findById.mockImplementation(async (id: string) =>
        id === 'plan-trial'
          ? { id: 'plan-trial', type: 'trial' }
          : { id: 'plan-1', type: 'paid', durationDays: 30, deviceLimit: 3, priceRub: 199, priceStars: 0 },
      );

      await useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' });

      expect(mockRemnawaveService.upgradeUser).toHaveBeenCalledWith('rw-trial', expect.any(Object));
      expect(mockRemnawaveService.addUserSquads).toHaveBeenCalledWith('rw-trial', [
        'squad-default',
        'squad-cdn',
      ]);
    });

    it('adds the paid squad when renewing an active paid subscription', async () => {
      setSquadEnv('squad-default', 'squad-cdn');
      mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
        id: 'sub-paid',
        planId: 'plan-1',
        remnawaveUserId: 'rw-paid',
        endDate: new Date(Date.now() + 86400000),
      });
      mockRemnawaveService.getUserExpireAt.mockResolvedValue(new Date());

      await useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' });

      expect(mockRemnawaveService.extendUser).toHaveBeenCalledWith('rw-paid', 30);
      expect(mockRemnawaveService.addUserSquads).toHaveBeenCalledWith('rw-paid', [
        'squad-default',
        'squad-cdn',
      ]);
    });

    it('still ensures the paid squad on retry when the Remnawave mutation is skipped', async () => {
      setSquadEnv('squad-default', 'squad-cdn');
      mockPaymentRepo.findById.mockResolvedValue(pendingPayment('rw-1'));

      await useCase.execute('user-1', 'plan-1', 'yookassa', { existingPaymentId: 'pay-1' });

      expect(mockRemnawaveService.createUser).not.toHaveBeenCalled();
      expect(mockRemnawaveService.addUserSquads).toHaveBeenCalledWith('rw-1', [
        'squad-default',
        'squad-cdn',
      ]);
    });

    it('does not fail the purchase when adding the paid squad fails', async () => {
      setSquadEnv('squad-default', 'squad-cdn');
      mockRemnawaveService.addUserSquads.mockRejectedValue(new Error('remnawave down'));

      const result = await useCase.execute('user-1', 'plan-1', 'yookassa', {
        existingPaymentId: 'pay-1',
        externalChargeId: 'yk-charge-1',
      });

      expect(result.subscriptionId).toBe('sub-1');
      expect(mockPaymentService.markAsCompleted).toHaveBeenCalledWith('pay-1', 'yk-charge-1');
    });
  });
});
