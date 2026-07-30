import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { sleep } from '../utils/index.js';

const CPU_SAMPLE_INTERVAL_MS = 200;

export interface VpsStats {
  cpuPercent: number;
  loadAverage: [number, number, number];
  memory: { usedBytes: number; totalBytes: number };
  disk: { usedBytes: number; totalBytes: number };
  uptimeSeconds: number;
}

/**
 * Читается напрямую из /proc через `os`/`fs.statfs` — без Docker socket и без
 * доп. инфраструктуры. Внутри контейнера без host-неймспейсов /proc не
 * виртуализирован Docker'ом (изолируются только cgroup-лимиты использования,
 * а не содержимое /proc), поэтому os.cpus()/totalmem()/loadavg() и статистика
 * файловой системы контейнера отражают реальный VPS, а не какие-то
 * container-only цифры.
 */
export async function getVpsStats(): Promise<VpsStats> {
  const [cpuPercent, disk] = await Promise.all([getCpuPercent(), getDiskStats()]);

  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();

  return {
    cpuPercent,
    loadAverage: os.loadavg() as [number, number, number],
    memory: { usedBytes: totalBytes - freeBytes, totalBytes },
    disk,
    uptimeSeconds: os.uptime(),
  };
}

/** Два замера os.cpus() с паузой между ними — мгновенный снимок times не даёт "загрузку в %", только счётчики тиков. */
async function getCpuPercent(): Promise<number> {
  const start = os.cpus();
  await sleep(CPU_SAMPLE_INTERVAL_MS);
  const end = os.cpus();

  let idleDiff = 0;
  let totalDiff = 0;
  for (let i = 0; i < start.length; i++) {
    const s = start[i]?.times;
    const e = end[i]?.times;
    if (!s || !e) continue;
    const idle = e.idle - s.idle;
    const total = e.user - s.user + (e.nice - s.nice) + (e.sys - s.sys) + (e.irq - s.irq) + idle;
    idleDiff += idle;
    totalDiff += total;
  }

  if (totalDiff <= 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;
}

async function getDiskStats(): Promise<{ usedBytes: number; totalBytes: number }> {
  const stats = await statfs('/');
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bfree * stats.bsize;
  return { usedBytes: totalBytes - freeBytes, totalBytes };
}
