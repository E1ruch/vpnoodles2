import { Router } from 'express';
import type { GetAdminOverviewUseCase } from '../../../application/usecases/GetAdminOverviewUseCase.js';
import type { GetUsersGrowthUseCase } from '../../../application/usecases/GetUsersGrowthUseCase.js';
import type { IRemnawaveService } from '../../../domain/interfaces/services.js';
import { getLogger } from '../../../shared/logger/index.js';

const VALID_GROWTH_RANGES = [7, 30, 90];

function parseGrowthDays(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '30'), 10);
  return VALID_GROWTH_RANGES.includes(parsed) ? parsed : 30;
}

export function createOverviewRouter(
  getAdminOverview: GetAdminOverviewUseCase,
  remnawaveService: IRemnawaveService,
  getUsersGrowth: GetUsersGrowthUseCase,
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

  router.get('/users-growth', async (req, res) => {
    try {
      const days = parseGrowthDays(req.query['days']);
      const result = await getUsersGrowth.execute(days);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to build users growth series');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
