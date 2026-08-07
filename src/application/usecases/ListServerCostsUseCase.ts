import type { IServerCostRepository } from '../../domain/interfaces/repositories.js';
import type { ServerCost } from '../../domain/entities/ServerCost.js';

export class ListServerCostsUseCase {
  constructor(private serverCostRepo: IServerCostRepository) {}

  execute(): Promise<ServerCost[]> {
    return this.serverCostRepo.findAll();
  }
}
