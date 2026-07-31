import { Repository } from 'typeorm';
import { getDataSource } from '../connection.js';
import { ReferralSettings } from '../../../domain/entities/ReferralSettings.js';
import type { IReferralSettingsRepository } from '../../../domain/interfaces/repositories.js';

export class ReferralSettingsRepository implements IReferralSettingsRepository {
  private getRepo(): Promise<Repository<ReferralSettings>> {
    return getDataSource().then((ds) => ds.getRepository(ReferralSettings));
  }

  async get(): Promise<ReferralSettings> {
    const repo = await this.getRepo();
    const existing = await repo.find({ order: { updatedAt: 'ASC' }, take: 1 });
    if (existing[0]) return existing[0];

    const settings = repo.create();
    return repo.save(settings);
  }

  async update(data: Partial<ReferralSettings>): Promise<ReferralSettings> {
    const current = await this.get();
    const repo = await this.getRepo();
    await repo.update(current.id, data);
    const updated = await repo.findOne({ where: { id: current.id } });
    if (!updated) throw new Error('ReferralSettings row disappeared after update');
    return updated;
  }
}
