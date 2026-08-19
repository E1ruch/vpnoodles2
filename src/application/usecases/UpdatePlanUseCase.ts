import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { Plan } from '../../domain/entities/Plan.js';
import type { CreatePlanInput } from './CreatePlanUseCase.js';

export type UpdatePlanInput = Partial<CreatePlanInput>;

export class UpdatePlanUseCase {
  constructor(private planRepo: IPlanRepository) {}

  execute(id: string, data: UpdatePlanInput): Promise<Plan> {
    return this.planRepo.update(id, data);
  }
}
