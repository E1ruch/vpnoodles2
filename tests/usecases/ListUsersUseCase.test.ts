import { ListUsersUseCase } from '../../src/application/usecases/ListUsersUseCase';

const mockUserRepo = {
  searchPaginated: jest.fn(),
};

describe('ListUsersUseCase', () => {
  let useCase: ListUsersUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new ListUsersUseCase(mockUserRepo as never);
  });

  it('maps repo results to list entries and forwards pagination params', async () => {
    mockUserRepo.searchPaginated.mockResolvedValue({
      items: [
        {
          id: 'u1',
          telegramId: 123,
          username: 'alice',
          firstName: 'Alice',
          lastName: null,
          isActive: true,
          hasUsedTrial: false,
          createdAt: new Date('2026-01-01'),
        },
      ],
      total: 1,
    });

    const result = await useCase.execute({ search: 'alice', page: 2, pageSize: 10 });

    expect(mockUserRepo.searchPaginated).toHaveBeenCalledWith({ search: 'alice', skip: 20, limit: 10 });
    expect(result).toEqual({
      items: [
        {
          id: 'u1',
          telegramId: 123,
          username: 'alice',
          firstName: 'Alice',
          lastName: null,
          isActive: true,
          hasUsedTrial: false,
          createdAt: new Date('2026-01-01'),
        },
      ],
      total: 1,
      page: 2,
      pageSize: 10,
    });
  });

  it('computes skip as page*pageSize for page 0', async () => {
    mockUserRepo.searchPaginated.mockResolvedValue({ items: [], total: 0 });

    await useCase.execute({ page: 0, pageSize: 20 });

    expect(mockUserRepo.searchPaginated).toHaveBeenCalledWith({ search: undefined, skip: 0, limit: 20 });
  });
});
