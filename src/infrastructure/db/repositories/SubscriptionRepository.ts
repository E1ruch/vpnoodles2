import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { Subscription } from '../../../domain/entities/Subscription.js';
import type { ISubscriptionRepository } from '../../../domain/interfaces/repositories.js';

export class SubscriptionRepository implements ISubscriptionRepository {
  private getRepo(): Promise<Repository<Subscription>> {
    return getDataSource().then((ds) => ds.getRepository(Subscription));
  }

  async findById(id: string): Promise<Subscription | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { id }, relations: ['plan', 'user'] });
  }

  async findActiveByUserId(userId: string): Promise<Subscription | null> {
    const repo = await this.getRepo();
    return repo.findOne({
      where: { userId, status: 'active' },
      relations: ['plan', 'user'],
      order: { endDate: 'DESC' },
    });
  }

  async findByUserId(userId: string): Promise<Subscription[]> {
    const repo = await this.getRepo();
    return repo.find({
      where: { userId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(): Promise<Subscription[]> {
    const repo = await this.getRepo();
    return repo.find({ relations: ['plan', 'user'], order: { createdAt: 'DESC' } });
  }

  async count(): Promise<number> {
    const repo = await this.getRepo();
    return repo.count();
  }

  async create(data: Partial<Subscription>): Promise<Subscription> {
    const repo = await this.getRepo();
    const sub = repo.create(data);
    return repo.save(sub);
  }

  async update(id: string, data: Partial<Subscription>): Promise<Subscription> {
    const repo = await this.getRepo();
    await repo.update(id, data);
    const sub = await repo.findOne({ where: { id }, relations: ['plan', 'user'] });
    if (!sub) throw new Error(`Subscription not found: ${id}`);
    return sub;
  }

  async findExpiringSoon(hours: number): Promise<Subscription[]> {
    const repo = await this.getRepo();
    const threshold = new Date();
    threshold.setHours(threshold.getHours() + hours);
    return repo.find({
      where: { status: 'active', endDate: threshold as unknown as Date },
      relations: ['user'],
    });
  }
}
