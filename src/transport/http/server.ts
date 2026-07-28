import path from 'node:path';
import express, { type Express, type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Telegraf } from 'telegraf';
import type { ICacheService, IRemnawaveService } from '../../domain/interfaces/services.js';
import type { GetAdminOverviewUseCase } from '../../application/usecases/GetAdminOverviewUseCase.js';
import { getLogger } from '../../shared/logger/index.js';
import { createAuthRouter } from './routes/auth.js';
import { createOverviewRouter } from './routes/overview.js';
import { createRequireAdminAuth } from './middleware/adminAuth.js';

export interface AdminHttpServerDeps {
  bot: Telegraf;
  cacheService: ICacheService;
  remnawaveService: IRemnawaveService;
  getAdminOverviewUseCase: GetAdminOverviewUseCase;
}

/** dist/transport/http (компилированный, CommonJS — __dirname доступен нативно) → ../../../admin-panel/dist в корне репо. */
const ADMIN_PANEL_DIST = path.resolve(__dirname, '../../../admin-panel/dist');

export function createAdminHttpApp(deps: AdminHttpServerDeps): Express {
  const app = express();
  const logger = getLogger();

  app.disable('x-powered-by');
  // За приложением стоит один reverse-proxy (nginx на той же VPS) — доверяем
  // ровно одному хопу X-Forwarded-For, иначе express-rate-limit не может
  // безопасно определить IP клиента и падает с ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          // Telegram Login Widget: сам скрипт грузится с telegram.org и
          // использует eval() внутри себя (это в самом виджете, не в нашем
          // коде) — без 'unsafe-eval' скрипт падает с EvalError и кнопка не
          // рендерится. Виджет рендерит iframe с oauth.telegram.org.
          'script-src': ["'self'", "'unsafe-eval'", 'https://telegram.org'],
          'frame-src': ["'self'", 'https://oauth.telegram.org'],
        },
      },
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/auth', authLimiter, createAuthRouter(deps.bot, deps.cacheService));

  const requireAdminAuth = createRequireAdminAuth(deps.cacheService);
  app.use(
    '/api/overview',
    requireAdminAuth,
    createOverviewRouter(deps.getAdminOverviewUseCase, deps.remnawaveService),
  );

  app.use(express.static(ADMIN_PANEL_DIST));

  // SPA fallback: любой GET вне /api/* отдаёт index.html (роутинг на стороне React).
  // Без строкового wildcard-паттерна маршрута — независимо от синтаксиса path-to-regexp в Express.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(ADMIN_PANEL_DIST, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    logger.error({ err }, 'Admin HTTP server error');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  return app;
}
