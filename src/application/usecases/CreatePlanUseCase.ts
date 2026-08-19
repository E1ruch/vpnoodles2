import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { Plan } from '../../domain/entities/Plan.js';
import type { PlanType } from '../../shared/types/index.js';

export interface CreatePlanInput {
  name: string;
  type: PlanType;
  durationDays: number;
  deviceLimit: number;
  priceStars: number;
  priceRub: number;
  isActive: boolean;
  sortOrder: number;
  remnawaveTag: string | null;
  description: string | null;
}

export class CreatePlanUseCase {
  constructor(private planRepo: IPlanRepository) {}

  execute(data: CreatePlanInput): Promise<Plan> {
    return this.planRepo.create(data);
  }
}
