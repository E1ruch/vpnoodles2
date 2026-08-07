import type { IServerCostRepository } from '../../domain/interfaces/repositories.js';
import type { ServerCost } from '../../domain/entities/ServerCost.js';

export interface UpsertServerCostInput {
  monthlyCostRub: number;
  nextPaymentDate: Date | null;
  note: string | null;
  nodeName: string | null;
}

export class UpsertServerCostUseCase {
  constructor(private serverCostRepo: IServerCostRepository) {}

  execute(nodeUuid: string, data: UpsertServerCostInput): Promise<ServerCost> {
    return this.serverCostRepo.upsert(nodeUuid, data);
  }
}
