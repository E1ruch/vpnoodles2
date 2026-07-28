import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Telegraf } from 'telegraf';
import type { ICacheService } from '../../../domain/interfaces/services.js';
import {
  verifyTelegramWidgetAuth,
  type TelegramWidgetAuthPayload,
} from '../../../infrastructure/auth/TelegramWidgetAuth.js';
import { parseAdminIds } from '../../../shared/utils/adminIds.js';
import { getEnv } from '../../../shared/config/env.js';
import { getLogger } from '../../../shared/logger/index.js';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSession,
  destroyAdminSession,
  createRequireAdminAuth,
} from '../middleware/adminAuth.js';

let cachedBotUsername: string | null = null;

async function getBotUsername(bot: Telegraf): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await bot.telegram.getMe();
  if (!me.username) throw new Error('Bot has no username');
  cachedBotUsername = me.username;
  return cachedBotUsername;
}

/** Сравнение без утечки по времени/длине строки (хэшируем перед timingSafeEqual). */
function secretsMatch(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

export function createAuthRouter(bot: Telegraf, cacheService: ICacheService): Router {
  const router = Router();
  const env = getEnv();
  const logger = getLogger();

  /**
   * Dev-логин по паролю в обход Telegram-виджета — только для локальной
   * разработки (виджет требует зарегистрированный в BotFather HTTPS-домен,
   * что неудобно перепрошивать на каждый рестарт ngrok-туннеля). Маршрут
   * вообще не регистрируется, если NODE_ENV=production или креды не заданы —
   * так что в проде этого пути физически нет, а не просто "выключен".
   */
  const devLoginEnabled =
    env.NODE_ENV !== 'production' && !!env.ADMIN_DEV_USERNAME && !!env.ADMIN_DEV_PASSWORD;

  /** Username бота для Telegram Login Widget + флаг наличия dev-логина — фронтенду не нужны отдельные env var. */
  router.get('/config', async (_req, res) => {
    try {
      const botUsername = await getBotUsername(bot);
      res.json({ botUsername, devLoginEnabled });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch bot username for admin login widget');
      res.status(502).json({ error: 'Failed to load auth config' });
    }
  });

  if (devLoginEnabled) {
    router.post('/dev-login', async (req, res) => {
      const body = req.body as { username?: unknown; password?: unknown } | undefined;
      const username = typeof body?.username === 'string' ? body.username : '';
      const password = typeof body?.password === 'string' ? body.password : '';

      if (
        !secretsMatch(username, env.ADMIN_DEV_USERNAME as string) ||
        !secretsMatch(password, env.ADMIN_DEV_PASSWORD as string)
      ) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      const [devAdminId] = parseAdminIds(env);
      if (devAdminId === undefined) {
        logger.error('Dev login: ADMIN_TELEGRAM_ID(S) is empty, cannot create a session');
        res.status(500).json({ error: 'No admin id configured' });
        return;
      }

      const sessionId = await createAdminSession(cacheService, devAdminId);
      res.cookie(ADMIN_SESSION_COOKIE, sessionId, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: ADMIN_SESSION_TTL_SECONDS * 1000,
        path: '/',
      });

      logger.info({ telegramId: devAdminId }, 'Admin dashboard dev login');
      res.json({ ok: true });
    });
  }

  router.post('/telegram', async (req, res) => {
    const payload = req.body as Partial<TelegramWidgetAuthPayload> | undefined;

    if (!payload || typeof payload.id !== 'number' || typeof payload.hash !== 'string') {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    if (!verifyTelegramWidgetAuth(payload as TelegramWidgetAuthPayload, env.TELEGRAM_BOT_TOKEN)) {
      res.status(401).json({ error: 'Invalid Telegram signature' });
      return;
    }

    const adminIds = parseAdminIds(env);
    if (!adminIds.has(payload.id)) {
      logger.warn({ telegramId: payload.id }, 'Admin dashboard login rejected: not in allowlist');
      res.status(403).json({ error: 'Not an admin' });
      return;
    }

    const sessionId = await createAdminSession(cacheService, payload.id);
    res.cookie(ADMIN_SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ADMIN_SESSION_TTL_SECONDS * 1000,
      path: '/',
    });

    logger.info({ telegramId: payload.id }, 'Admin dashboard login');
    res.json({ ok: true });
  });

  router.post('/logout', async (req, res) => {
    const sessionId = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (typeof sessionId === 'string' && sessionId) {
      await destroyAdminSession(cacheService, sessionId);
    }
    res.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  const requireAdminAuth = createRequireAdminAuth(cacheService);
  router.get('/me', requireAdminAuth, (req, res) => {
    res.json({ telegramId: req.adminId });
  });

  return router;
}
