import { PurchasePlanUseCase } from '../../src/application/usecases/PurchasePlanUseCase';
import { PaymentLockedError } from '../../src/shared/errors/index';

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

describe('PurchasePlanUseCase — fulfillment lock', () => {
  let useCase: PurchasePlanUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
