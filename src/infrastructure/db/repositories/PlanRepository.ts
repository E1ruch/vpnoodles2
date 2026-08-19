import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { Plan } from '../../../domain/entities/Plan.js';
import type { IPlanRepository } from '../../../domain/interfaces/repositories.js';
import type { PlanType } from '../../../shared/types/index.js';
import { PlanInUseError } from '../../../shared/errors/index.js';

const POSTGRES_FOREIGN_KEY_VIOLATION = '23503';

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

  async findAll(): Promise<Plan[]> {
    const repo = await this.getRepo();
    return repo.find({ order: { sortOrder: 'ASC' } });
  }

  async create(data: Partial<Plan>): Promise<Plan> {
    const repo = await this.getRepo();
    const plan = repo.create(data);
    return repo.save(plan);
  }

  async update(id: string, data: Partial<Plan>): Promise<Plan> {
    const repo = await this.getRepo();
    await repo.update(id, data);
    const plan = await repo.findOne({ where: { id } });
    if (!plan) throw new Error(`Plan not found: ${id}`);
    return plan;
  }

  async delete(id: string): Promise<void> {
    const repo = await this.getRepo();
    try {
      await repo.delete(id);
    } catch (error) {
      const isForeignKeyViolation = (error as { code?: string })?.code === POSTGRES_FOREIGN_KEY_VIOLATION;
      if (isForeignKeyViolation) {
        throw new PlanInUseError(id);
      }
      throw error;
    }
  }
}
