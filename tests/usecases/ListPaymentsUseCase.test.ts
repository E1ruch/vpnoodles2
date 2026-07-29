import { ListPaymentsUseCase } from '../../src/application/usecases/ListPaymentsUseCase';

const mockPaymentRepo = {
  findPaginated: jest.fn(),
};

describe('ListPaymentsUseCase', () => {
  let useCase: ListPaymentsUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListPaymentsUseCase(mockPaymentRepo as never);
  });

  it('maps payments to entries with userId + userLabel for cross-linking, and forwards status/pagination', async () => {
    mockPaymentRepo.findPaginated.mockResolvedValue({
      items: [
        {
          id: 'p1',
          userId: 'u1',
          user: { username: 'alice' },
          plan: { name: 'Pro' },
          planId: 'plan1',
          amount: 199,
          currency: 'RUB',
          provider: 'yookassa',
          status: 'completed',
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'p2',
          userId: 'u2',
          user: null,
          plan: null,
          planId: 'plan2',
          amount: 50,
          currency: 'XTR',
          provider: 'stars',
          status: 'pending',
          createdAt: new Date('2026-01-02'),
        },
      ],
      total: 2,
    });

    const result = await useCase.execute({ status: 'completed', page: 1, pageSize: 5 });

    expect(mockPaymentRepo.findPaginated).toHaveBeenCalledWith({ status: 'completed', skip: 5, limit: 5 });
    expect(result.items).toEqual([
      {
        id: 'p1',
        userId: 'u1',
        userLabel: '@alice',
        planLabel: 'Pro',
        amount: 199,
        currency: 'RUB',
        provider: 'yookassa',
        status: 'completed',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: 'p2',
        userId: 'u2',
        userLabel: 'u2',
        planLabel: 'plan2',
        amount: 50,
        currency: 'XTR',
        provider: 'stars',
        status: 'pending',
        createdAt: new Date('2026-01-02'),
      },
    ]);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
  });
});
