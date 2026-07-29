import { Router } from 'express';
import type { ListNotificationLogsUseCase } from '../../../application/usecases/ListNotificationLogsUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';
import { parsePagination } from '../pagination.js';
import type { NotificationType } from '../../../domain/entities/NotificationLog.js';

const VALID_TYPES: NotificationType[] = [
  'no_subscription_reminder_1h',
  'no_subscription_reminder_3d',
  'trial_expiring_2d',
  'paid_expiring_2d',
];

function parseType(value: unknown): NotificationType | undefined {
  return typeof value === 'string' && (VALID_TYPES as string[]).includes(value)
    ? (value as NotificationType)
    : undefined;
}

export function createNotificationsRouter(listNotificationLogs: ListNotificationLogsUseCase): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/', async (req, res) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const type = parseType(req.query['type']);
      const result = await listNotificationLogs.execute({ type, page, pageSize });
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Failed to list notification logs');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
