import { Router } from 'express';
import type { ListPaymentsUseCase } from '../../../application/usecases/ListPaymentsUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';
import { parsePagination } from '../pagination.js';
import type { PaymentStatus } from '../../../shared/types/index.js';

const VALID_STATUSES: PaymentStatus[] = ['pending', 'completed', 'failed', 'refunded'];

function parseStatus(value: unknown): PaymentStatus | undefined {
  return typeof value === 'string' && (VALID_STATUSES as string[]).includes(value)
    ? (value as PaymentStatus)
    : undefined;
}

export function createPaymentsRouter(listPayments: ListPaymentsUseCase): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (req, res) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const status = parseStatus(req.query['status']);
      const result = await listPayments.execute({ status, page, pageSize });
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to list payments');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
