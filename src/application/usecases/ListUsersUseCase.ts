import type { IUserRepository } from '../../domain/interfaces/repositories.js';

export interface UserListEntry {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  hasUsedTrial: boolean;
  createdAt: Date;
}

export interface ListUsersResult {
  items: UserListEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export class ListUsersUseCase {
  constructor(private userRepo: IUserRepository) {}

  async execute(params: { search?: string; page: number; pageSize: number }): Promise<ListUsersResult> {
    const { items, total } = await this.userRepo.searchPaginated({
      search: params.search,
      skip: params.page * params.pageSize,
      limit: params.pageSize,
    });

    return {
      items: items.map((user) => ({
        id: user.id,
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        hasUsedTrial: user.hasUsedTrial,
        createdAt: user.createdAt,
      })),
      total,
      page: params.page,
      pageSize: params.pageSize,
    };
  }
}
