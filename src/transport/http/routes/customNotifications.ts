import { Router } from 'express';
import type {
  SendCustomNotificationUseCase,
  SendCustomNotificationInput,
} from '../../../application/usecases/SendCustomNotificationUseCase.js';
import { getLogger } from '../../../shared/logger/index.js';
import { isAppError } from '../../../shared/errors/index.js';

const TELEGRAM_TEXT_MAX_LENGTH = 4096;

function parseBody(body: unknown, adminTelegramId: number): SendCustomNotificationInput | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be an object' };
  }
  const { audience, userId, text, button } = body as Record<string, unknown>;

  if (audience !== 'user' && audience !== 'all') {
    return { error: 'audience must be "user" or "all"' };
  }
  if (audience === 'user' && (typeof userId !== 'string' || !userId)) {
    return { error: 'userId is required when audience is "user"' };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'text must be a non-empty string' };
  }
  if (text.length > TELEGRAM_TEXT_MAX_LENGTH) {
    return { error: `text must be at most ${TELEGRAM_TEXT_MAX_LENGTH} characters` };
  }

  let parsedButton: SendCustomNotificationInput['button'] = null;
  if (button !== undefined && button !== null) {
    if (typeof button !== 'object') {
      return { error: 'button must be an object' };
    }
    const { label, url } = button as Record<string, unknown>;
    if (typeof label !== 'string' || !label.trim() || typeof url !== 'string' || !url.trim()) {
      return { error: 'button.label and button.url are required when button is present' };
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return { error: 'button.url must use http or https' };
      }
    } catch {
      return { error: 'button.url must be a valid URL' };
    }
    parsedButton = { label, url };
  }

  return {
    audience,
    userId: audience === 'user' ? (userId as string) : undefined,
    text,
    button: parsedButton,
    adminTelegramId,
  };
}

export function createCustomNotificationsRouter(
  sendCustomNotification: SendCustomNotificationUseCase,
): Router {
  const router = Router();
  const logger = getLogger();

  router.get('/audience-count', async (req, res) => {
    try {
      if (req.query['audience'] !== 'all') {
        res.status(400).json({ error: 'audience must be "all"' });
        return;
      }
      const count = await sendCustomNotification.getAudienceCount();
      res.json({ count });
    } catch (err) {
      logger.error({ err }, 'Failed to compute audience count');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const parsed = parseBody(req.body, req.adminId as number);
      if ('error' in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const { completion, ...result } = await sendCustomNotification.execute(parsed);
      completion.catch((err) => {
        logger.error({ err }, 'Custom notification background completion failed');
      });

      res.status(result.audience === 'all' ? 202 : 200).json(result);
    } catch (err) {
      if (isAppError(err)) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      logger.error({ err }, 'Failed to send custom notification');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
