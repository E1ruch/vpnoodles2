import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { ServerCost } from '../../../domain/entities/ServerCost.js';
import type { IServerCostRepository } from '../../../domain/interfaces/repositories.js';

export class ServerCostRepository implements IServerCostRepository {
  private getRepo(): Promise<Repository<ServerCost>> {
    return getDataSource().then((ds) => ds.getRepository(ServerCost));
  }

  async findAll(): Promise<ServerCost[]> {
    const repo = await this.getRepo();
    return repo.find({ order: { createdAt: 'ASC' } });
  }

  async findByNodeUuid(nodeUuid: string): Promise<ServerCost | null> {
    const repo = await this.getRepo();
    return repo.findOne({ where: { nodeUuid } });
  }

  async upsert(
    nodeUuid: string,
    data: { monthlyCostRub: number; nextPaymentDate: Date | null; note: string | null; nodeName: string | null },
  ): Promise<ServerCost> {
    const repo = await this.getRepo();
    const existing = await repo.findOne({ where: { nodeUuid } });

    if (existing) {
      await repo.update(existing.id, data);
      const updated = await repo.findOne({ where: { id: existing.id } });
      if (!updated) throw new Error('ServerCost row disappeared after update');
      return updated;
    }

    const created = repo.create({ nodeUuid, ...data });
    return repo.save(created);
  }

  async deleteByNodeUuid(nodeUuid: string): Promise<void> {
    const repo = await this.getRepo();
    await repo.delete({ nodeUuid });
  }
}
