import { Router } from 'express';
import type { ListAuditLogsUseCase } from '../../../application/usecases/ListAuditLogsUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';
import { parsePagination } from '../pagination.js';

export function createLogsRouter(listAuditLogs: ListAuditLogsUseCase): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (req, res) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await listAuditLogs.execute({ page, pageSize });
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to list audit logs');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
