import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { Plan } from '../../../domain/entities/Plan.js';
import type { IPlanRepository } from '../../../domain/interfaces/repositories.js';
import type { PlanType } from '../../../shared/types/index.js';

export class PlanRepository implements IPlanRepository {
  private getRepo(): Promise<Repository<Plan>> {
    return getDataSource().then((ds) => ds.getRepository(Plan));
  }

  async findById(id: string): Promise<Plan | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { id } });
  }

  async findByType(type: PlanType): Promise<Plan[]> {
    const repo = await this.getRepo();
    return repo.find({ where: { type, isActive: true }, order: { sortOrder: 'ASC' } });
  }

  async findActive(): Promise<Plan[]> {
    const repo = await this.getRepo();
    return repo.find({ where: { isActive: true }, order: { sortOrder: 'ASC' } });
  }

  async create(data: Partial<Plan>): Promise<Plan> {
    const repo = await this.getRepo();
    const plan = repo.create(data);
    return repo.save(plan);
  }
}
