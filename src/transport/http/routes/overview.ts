import { Router } from 'express';
import type { GetAdminOverviewUseCase } from '../../../application/usecases/GetAdminOverviewUseCase.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import { getLogger } from '../../../shared/logger/index.js';

export function createOverviewRouter(
  getAdminOverview: GetAdminOverviewUseCase,
  remnawaveService: IRemnawaveService,
): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (_req, res) => {
    try {
      const [overview, nodes] = await Promise.all([
        getAdminOverview.execute(),
        remnawaveService.getNodes().catch((err) => {
          logger.warn({ err }, 'Failed to fetch Remnawave nodes for admin overview');
          return [];
        }),
      ]);

      res.json({ ...overview, nodes });
    } catch (err) {
      logger.error({ err }, 'Failed to build admin overview');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
