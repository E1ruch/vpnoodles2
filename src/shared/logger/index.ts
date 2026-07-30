import pino from 'pino';
import { getEnv } from '../config/env.js';

let _logger: pino.Logger | null = null;

export interface RecentErrorEntry {
  time: number;
  message: string;
}

const MAX_RECENT_ERRORS = 50;
const recentErrors: RecentErrorEntry[] = [];

/**
 * Кольцевой буфер последних ошибок в памяти процесса — для виджета
 * мониторинга ("последние N ошибок"). Сознательно не БД и не файл: не нужна
 * миграция, не нужно решать retention, а после каждого деплоя (restart:
 * unless-stopped) старые ошибки всё равно уже неактуальны — важны свежие.
 * Точка входа — hooks.logMethod у pino, а не отдельная обёртка над logger.error():
 * ловит вообще все вызовы .error()/.fatal() по всему коду, а не только те,
 * что явно решили что-то куда-то продублировать.
 */
function recordError(level: number, args: unknown[]): void {
  if (level < 50) return; // pino: error=50, fatal=60

  const first = args[0];
  let message: string;
  if (typeof first === 'string') {
    message = first;
  } else if (first && typeof first === 'object') {
    const obj = first as { msg?: unknown; err?: { message?: unknown }; error?: { message?: unknown } };
    const second = typeof args[1] === 'string' ? args[1] : undefined;
    message = second ?? String(obj.msg ?? obj.err?.message ?? obj.error?.message ?? 'Unknown error');
  } else {
    message = 'Unknown error';
  }

  recentErrors.push({ time: Date.now(), message });
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.shift();
}

/** Новые сначала — для виджета мониторинга. */
export function getRecentErrors(): RecentErrorEntry[] {
  return [...recentErrors].reverse();
}

export function getLogger(): pino.Logger {
  if (_logger) return _logger;

  const env = getEnv();
  _logger = pino({
    level: env.NODE_ENV === 'development' ? 'debug' : 'info',
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    hooks: {
      logMethod(args, method, level) {
        recordError(level, args as unknown[]);
        return method.apply(this, args as Parameters<typeof method>);
      },
    },
  });

  return _logger;
}
