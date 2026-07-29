import { In, Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { User } from '../../../domain/entities/User.js';
import type { IUserRepository, Paginated } from '../../../domain/interfaces/repositories.js';

export class UserRepository implements IUserRepository {
  private getRepo(): Promise<Repository<User>> {
    return getDataSource().then((ds) => ds.getRepository(User));
  }

  async findById(id: string): Promise<User | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { id } });
  }

  async findByTelegramId(telegramId: number): Promise<User | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { telegramId } });
  }

  async findAll(): Promise<User[]> {
    const repo = await this.getRepo();
    return repo.find({ order: { createdAt: 'DESC' } });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const repo = await this.getRepo();
    return repo.findBy({ id: In(ids) });
  }

  async count(): Promise<number> {
    const repo = await this.getRepo();
    return repo.count();
  }

  async create(data: Partial<User>): Promise<User> {
    const repo = await this.getRepo();
    const user = repo.create(data);
    return repo.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const repo = await this.getRepo();
    await repo.update(id, data);
    const user = await repo.findOne({ where: { id } });
    if (!user) throw new Error(`User not found: ${id}`);
    return user;
  }

  async searchPaginated(params: { search?: string; skip: number; limit: number }): Promise<Paginated<User>> {
    const repo = await this.getRepo();
    const qb = repo
      .createQueryBuilder('user')
      .orderBy('user.createdAt', 'DESC')
      .skip(params.skip)
      .take(params.limit);

    const search = params.search?.trim();
    if (search) {
      const asTelegramId = Number(search);
      if (Number.isFinite(asTelegramId) && /^\d+$/.test(search)) {
        qb.where('user.telegramId = :telegramId', { telegramId: asTelegramId });
      } else {
        qb.where(
          '(user.username ILIKE :search OR user.firstName ILIKE :search OR user.lastName ILIKE :search)',
          { search: `%${search}%` },
        );
      }
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
