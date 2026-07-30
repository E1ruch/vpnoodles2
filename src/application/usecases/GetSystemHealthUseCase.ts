import type { Telegraf } from 'telegraf';
import type { ICacheService, IRemnawaveService, IDatabaseHealthService } from '../../domain/interfaces/services.js';
import { getVpsStats, type VpsStats } from '../../shared/system/vpsStats.js';
import { getRecentErrors } from '../../shared/logger/index.js';

export type ComponentStatus = 'ok' | 'critical';
export type OverallStatus = 'ok' | 'warning' | 'critical';

export interface SystemComponentHealth {
  name: 'postgres' | 'redis' | 'telegram_bot' | 'remnawave';
  label: string;
  status: ComponentStatus;
  latencyMs: number | null;
  message: string | null;
}

export interface SystemHealthResult {
  status: OverallStatus;
  checkedAt: string;
  vps: VpsStats;
  components: SystemComponentHealth[];
  warnings: string[];
  recentErrors: Array<{ time: string; message: string }>;
}

const RAM_WARNING_PERCENT = 90;
const DISK_WARNING_PERCENT = 90;
const CPU_WARNING_PERCENT = 95;
const RECENT_ERRORS_LIMIT = 10;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number; value: T | null }> {
  const start = Date.now();
  try {
    const value = await fn();
    return { ok: true, latencyMs: Date.now() - start, value };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, value: null };
  }
}

/**
 * Агрегированное состояние системы для виджета «Мониторинг» в веб-админке:
 * ресурсы VPS (читаются напрямую, см. vpsStats.ts) + доступность зависимостей
 * приложения (БД/Redis/Telegram/Remnawave) + предупреждения по порогам +
 * последние ошибки из in-memory кольцевого буфера логгера.
 *
 * Docker-контейнеры и Nginx сознательно не проверяются: контейнер приложения
 * не имеет доступа к Docker socket'у хоста, а Nginx работает на хосте вне
 * Docker — оба варианта потребовали бы отдельного расширения инфраструктуры
 * (проброс /var/run/docker.sock или stub_status у Nginx), на что явно решили
 * не идти в этой итерации.
 */
export class GetSystemHealthUseCase {
  constructor(
    private bot: Telegraf,
    private cacheService: ICacheService,
    private remnawaveService: IRemnawaveService,
    private databaseHealthService: IDatabaseHealthService,
  ) {}

  async execute(): Promise<SystemHealthResult> {
    const [vps, dbCheck, redisCheck, botCheck, remnawaveCheck] = await Promise.all([
      getVpsStats(),
      this.databaseHealthService.ping(),
      timed(() => this.cacheService.ping()),
      timed(() => this.bot.telegram.getMe()),
      timed(() => this.remnawaveService.getNodes()),
    ]);

    const components: SystemComponentHealth[] = [
      {
        name: 'postgres',
        label: 'PostgreSQL',
        status: dbCheck.ok ? 'ok' : 'critical',
        latencyMs: dbCheck.latencyMs,
        message: dbCheck.ok ? null : 'Нет соединения с базой данных',
      },
      {
        name: 'redis',
        label: 'Redis',
        status: redisCheck.ok && redisCheck.value ? 'ok' : 'critical',
        latencyMs: redisCheck.latencyMs,
        message: redisCheck.ok && redisCheck.value ? null : 'Redis не отвечает',
      },
      {
        name: 'telegram_bot',
        label: 'Telegram Bot',
        status: botCheck.ok ? 'ok' : 'critical',
        latencyMs: botCheck.latencyMs,
        message: botCheck.ok ? null : 'Telegram Bot API недоступен',
      },
      {
        name: 'remnawave',
        label: 'Remnawave',
        status: remnawaveCheck.ok ? 'ok' : 'critical',
        latencyMs: remnawaveCheck.latencyMs,
        message: remnawaveCheck.ok ? null : 'Remnawave API недоступен',
      },
    ];

    const warnings: string[] = [];
    const memPercent = (vps.memory.usedBytes / vps.memory.totalBytes) * 100;
    if (memPercent > RAM_WARNING_PERCENT) {
      warnings.push(`Использование RAM: ${memPercent.toFixed(0)}%`);
    }
    const diskPercent = (vps.disk.usedBytes / vps.disk.totalBytes) * 100;
    if (diskPercent > DISK_WARNING_PERCENT) {
      warnings.push(`Использование диска: ${diskPercent.toFixed(0)}%`);
    }
    if (vps.cpuPercent > CPU_WARNING_PERCENT) {
      warnings.push(`Загрузка CPU: ${vps.cpuPercent.toFixed(0)}%`);
    }
    for (const component of components) {
      if (component.status === 'critical') {
        warnings.push(`${component.label}: ${component.message ?? 'недоступен'}`);
      }
    }

    const hasCritical = components.some((c) => c.status === 'critical');
    const status: OverallStatus = hasCritical ? 'critical' : warnings.length > 0 ? 'warning' : 'ok';

    return {
      status,
      checkedAt: new Date().toISOString(),
      vps,
      components,
      warnings,
      recentErrors: getRecentErrors()
        .slice(0, RECENT_ERRORS_LIMIT)
        .map((e) => ({ time: new Date(e.time).toISOString(), message: e.message })),
    };
  }
}
