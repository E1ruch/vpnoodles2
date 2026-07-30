import { Router } from 'express';
import type { GetSystemHealthUseCase } from '../../../application/usecases/GetSystemHealthUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';

export function createSystemHealthRouter(getSystemHealth: GetSystemHealthUseCase): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (_req, res) => {
    try {
      const result = await getSystemHealth.execute();
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to build system health snapshot');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
