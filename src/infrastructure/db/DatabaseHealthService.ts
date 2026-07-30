import { getDataSource } from './connection.js';
import type { IDatabaseHealthService } from '../../domain/interfaces/services.js';

export class DatabaseHealthService implements IDatabaseHealthService {
  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const dataSource = await getDataSource();
      await dataSource.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}
