import { Router } from 'express';
import type { ListServerCostsUseCase } from '../../../application/usecases/ListServerCostsUseCase.js';
import type { UpsertServerCostUseCase } from '../../../application/usecases/UpsertServerCostUseCase.js';
import type { DeleteServerCostUseCase } from '../../../application/usecases/DeleteServerCostUseCase.js';
import type { GetServerCostSummaryUseCase } from '../../../application/usecases/GetServerCostSummaryUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';

const VALID_SUMMARY_MONTHS = [6, 12];

function parseSummaryMonths(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '12'), 10);
  return VALID_SUMMARY_MONTHS.includes(parsed) ? parsed : 12;
}

interface ParsedServerCostInput {
  monthlyCostRub: number;
  nextPaymentDate: Date | null;
  note: string | null;
  nodeName: string | null;
}

function parseServerCostInput(body: unknown): ParsedServerCostInput | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }
  const input = body as Record<string, unknown>;

  const monthlyCostRub = input['monthlyCostRub'];
  if (typeof monthlyCostRub !== 'number' || !Number.isInteger(monthlyCostRub) || monthlyCostRub < 0) {
    return { error: 'monthlyCostRub must be a non-negative integer' };
  }

  let nextPaymentDate: Date | null = null;
  if (input['nextPaymentDate'] !== undefined && input['nextPaymentDate'] !== null) {
    if (typeof input['nextPaymentDate'] !== 'string') {
      return { error: 'nextPaymentDate must be an ISO date string or null' };
    }
    const parsedDate = new Date(input['nextPaymentDate']);
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: 'nextPaymentDate must be a valid date' };
    }
    nextPaymentDate = parsedDate;
  }

  let note: string | null = null;
  if (input['note'] !== undefined && input['note'] !== null) {
    if (typeof input['note'] !== 'string' || input['note'].length > 500) {
      return { error: 'note must be a string up to 500 characters' };
    }
    note = input['note'];
  }

  let nodeName: string | null = null;
  if (input['nodeName'] !== undefined && input['nodeName'] !== null) {
    if (typeof input['nodeName'] !== 'string' || input['nodeName'].length > 255) {
      return { error: 'nodeName must be a string up to 255 characters' };
    }
    nodeName = input['nodeName'];
  }

  return { monthlyCostRub, nextPaymentDate, note, nodeName };
}

export function createServersRouter(deps: {
  listServerCosts: ListServerCostsUseCase;
  upsertServerCost: UpsertServerCostUseCase;
  deleteServerCost: DeleteServerCostUseCase;
  getServerCostSummary: GetServerCostSummaryUseCase;
}): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/costs', async (_req, res) => {
    try {
      res.json(await deps.listServerCosts.execute());
    } catch (err) {
      logger.error({ err }, 'Failed to list server costs');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/costs/:nodeUuid', async (req, res) => {
    try {
      const parsed = parseServerCostInput(req.body);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      res.json(await deps.upsertServerCost.execute(req.params['nodeUuid']!, parsed));
    } catch (err) {
      logger.error({ err }, 'Failed to upsert server cost');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/costs/:nodeUuid', async (req, res) => {
    try {
      await deps.deleteServerCost.execute(req.params['nodeUuid']!);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Failed to delete server cost');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/cost-summary', async (req, res) => {
    try {
      const months = parseSummaryMonths(req.query['months']);
      res.json(await deps.getServerCostSummary.execute(months));
    } catch (err) {
      logger.error({ err }, 'Failed to build server cost summary');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
