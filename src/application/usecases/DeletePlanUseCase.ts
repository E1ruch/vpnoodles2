import type { IPlanRepository } from '../../domain/interfaces/repositories.js';

export class DeletePlanUseCase {
  constructor(private planRepo: IPlanRepository) {}

  execute(id: string): Promise<void> {
    return this.planRepo.delete(id);
  }
}
