import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { User } from '../../../domain/entities/User.js';
import type { IUserRepository } from '../../../domain/interfaces/repositories.js';

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
}
