import type { IPlanRepository, ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { Plan } from '../../domain/entities/Plan.js';

export interface PlanWithStats extends Plan {
  activeSubscriptionsCount: number;
}

export class ListPlansUseCase {
  constructor(
    private planRepo: IPlanRepository,
    private subscriptionRepo: ISubscriptionRepository,
  ) {}

  async execute(): Promise<PlanWithStats[]> {
    const [plans, counts] = await Promise.all([this.planRepo.findAll(), this.subscriptionRepo.countActiveByPlan()]);
    const countByPlanId = new Map(counts.map((row) => [row.planId, row.count]));
    return plans.map((plan) => ({ ...plan, activeSubscriptionsCount: countByPlanId.get(plan.id) ?? 0 }));
  }
}
