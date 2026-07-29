import { Router } from 'express';
import type { ListUsersUseCase } from '../../../application/usecases/ListUsersUseCase.js';
import type { GetUserDetailUseCase } from '../../../application/usecases/GetUserDetailUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';
import { parsePagination } from '../pagination.js';

export function createUsersRouter(listUsers: ListUsersUseCase, getUserDetail: GetUserDetailUseCase): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (req, res) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
      const result = await listUsers.execute({ search, page, pageSize });
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to list users');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const detail = await getUserDetail.execute(req.params['id'] as string);
      if (!detail) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      res.json(detail);
    } catch (err) {
      logger.error({ err }, 'Failed to load user detail');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
