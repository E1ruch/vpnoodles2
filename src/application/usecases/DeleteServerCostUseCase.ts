import type { IServerCostRepository } from '../../domain/interfaces/repositories.js';

export class DeleteServerCostUseCase {
  constructor(private serverCostRepo: IServerCostRepository) {}

  execute(nodeUuid: string): Promise<void> {
    return this.serverCostRepo.deleteByNodeUuid(nodeUuid);
  }
}
