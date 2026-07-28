import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { ICacheService } from '../../../domain/interfaces/services.js';

export const ADMIN_SESSION_COOKIE = 'admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface AdminSessionData {
  telegramId: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    adminId?: number;
  }
}

function sessionKey(sessionId: string): string {
  return `admin:session:${sessionId}`;
}

/**
 * Opaque server-side сессия в Redis (через уже существующий ICacheService) —
 * не JWT, чтобы не заводить ещё один секрет и чтобы отзыв сессии был
 * тривиальным (cacheService.delete), см. GetAdminOverviewUseCase/план дашборда.
 */
export async function createAdminSession(cacheService: ICacheService, telegramId: number): Promise<string> {
  const sessionId = randomBytes(32).toString('hex');
  await cacheService.set<AdminSessionData>(sessionKey(sessionId), { telegramId }, ADMIN_SESSION_TTL_SECONDS);
  return sessionId;
}

export async function destroyAdminSession(cacheService: ICacheService, sessionId: string): Promise<void> {
  await cacheService.delete(sessionKey(sessionId));
}

export function createRequireAdminAuth(cacheService: ICacheService) {
  return async function requireAdminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const sessionId = req.cookies?.[ADMIN_SESSION_COOKIE];
    if (typeof sessionId !== 'string' || !sessionId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const session = await cacheService.get<AdminSessionData>(sessionKey(sessionId));
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    req.adminId = session.telegramId;
    next();
  };
}
