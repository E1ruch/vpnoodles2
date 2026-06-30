import { PaymentOrchestrator } from '../../src/infrastructure/payments/PaymentOrchestrator';
import { PaymentError } from '../../src/shared/errors/index';

// Mock repositories
const mockPaymentRepo = {
  findById: jest.fn(),
  findByExternalId: jest.fn(),
  findByUserId: jest.fn(),
  findPendingByUserId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  findCompletedByUserIdAndPlanId: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
};

describe('PaymentOrchestrator', () => {
  let orchestrator: PaymentOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    orchestrator = new PaymentOrchestrator(mockPaymentRepo as never, mockCacheService as never);
  });

  describe('createPayment', () => {
    it('should return existing pending payment if one exists', async () => {
      const existingPayment = {
        id: 'pay-1',
        userId: 'user-1',
        planId: 'plan-1',
        provider: 'stars' as const,
        status: 'pending' as const,
        amount: 150,
        currency: 'XTR',
        externalPaymentId: null,
        createdAt: new Date(),
      };
      mockPaymentRepo.findPendingByUserId.mockResolvedValue(existingPayment);

      const result = await orchestrator.createPayment('user-1', 'plan-1', 'stars', 150, 'XTR');

      expect(result.paymentId).toBe('pay-1');
      expect(result.status).toBe('pending');
      expect(mockPaymentRepo.create).not.toHaveBeenCalled();
    });

    it('should create a new payment when no pending payment exists', async () => {
      mockPaymentRepo.findPendingByUserId.mockResolvedValue(null);
      mockCacheService.exists.mockResolvedValue(false);
      mockCacheService.set.mockResolvedValue(undefined);
      mockCacheService.delete.mockResolvedValue(undefined);
      mockPaymentRepo.create.mockResolvedValue({
        id: 'pay-new',
        userId: 'user-1',
        planId: 'plan-1',
        provider: 'stars',
        status: 'pending',
        amount: 150,
        currency: 'XTR',
      });

      const result = await orchestrator.createPayment('user-1', 'plan-1', 'stars', 150, 'XTR');

      expect(result.paymentId).toBe('pay-new');
      expect(result.provider).toBe('stars');
      expect(mockPaymentRepo.create).toHaveBeenCalled();
    });

    it('should throw PaymentError if lock already exists', async () => {
      mockPaymentRepo.findPendingByUserId.mockResolvedValue(null);
      mockCacheService.exists.mockResolvedValue(true);

      await expect(
        orchestrator.createPayment('user-1', 'plan-1', 'stars', 150, 'XTR'),
      ).rejects.toThrow(PaymentError);
    });
  });

  describe('verifyPayment', () => {
    it('should return true for completed payment', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        id: 'pay-1',
        status: 'completed',
      });

      const result = await orchestrator.verifyPayment('pay-1');
      expect(result).toBe(true);
    });

    it('should return false for non-existent payment', async () => {
      mockPaymentRepo.findById.mockResolvedValue(null);

      const result = await orchestrator.verifyPayment('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for pending payment', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        id: 'pay-1',
        status: 'pending',
      });

      const result = await orchestrator.verifyPayment('pay-1');
      expect(result).toBe(false);
    });
  });

  describe('cancelPayment', () => {
    it('should cancel a pending payment', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        id: 'pay-1',
        status: 'pending',
      });
      mockPaymentRepo.update.mockResolvedValue({
        id: 'pay-1',
        status: 'failed',
      });

      await orchestrator.cancelPayment('pay-1');
      expect(mockPaymentRepo.update).toHaveBeenCalledWith('pay-1', { status: 'failed' });
    });

    it('should throw error when cancelling completed payment', async () => {
      mockPaymentRepo.findById.mockResolvedValue({
        id: 'pay-1',
        status: 'completed',
      });

      await expect(orchestrator.cancelPayment('pay-1')).rejects.toThrow(PaymentError);
    });
  });
});
