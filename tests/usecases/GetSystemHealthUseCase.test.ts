jest.mock('../../src/shared/system/vpsStats', () => ({
  getVpsStats: jest.fn(),
}));
jest.mock('../../src/shared/logger/index', () => ({
  getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
  getRecentErrors: jest.fn(),
}));

import { GetSystemHealthUseCase } from '../../src/application/usecases/GetSystemHealthUseCase';
import { getVpsStats } from '../../src/shared/system/vpsStats';
import { getRecentErrors } from '../../src/shared/logger/index';

const mockGetVpsStats = getVpsStats as jest.Mock;
const mockGetRecentErrors = getRecentErrors as jest.Mock;

const mockBot = { telegram: { getMe: jest.fn() } };
const mockCacheService = { ping: jest.fn() };
const mockRemnawaveService = { getNodes: jest.fn() };
const mockDatabaseHealthService = { ping: jest.fn() };

const healthyVpsStats = {
  cpuPercent: 12,
  loadAverage: [0.1, 0.2, 0.3] as [number, number, number],
  memory: { usedBytes: 40, totalBytes: 100 },
  disk: { usedBytes: 30, totalBytes: 100 },
  uptimeSeconds: 12345,
};

describe('GetSystemHealthUseCase', () => {
  let useCase: GetSystemHealthUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVpsStats.mockResolvedValue(healthyVpsStats);
    mockGetRecentErrors.mockReturnValue([]);
    mockCacheService.ping.mockResolvedValue(true);
    mockBot.telegram.getMe.mockResolvedValue({ id: 1 });
    mockRemnawaveService.getNodes.mockResolvedValue([]);
    mockDatabaseHealthService.ping.mockResolvedValue({ ok: true, latencyMs: 5 });

    useCase = new GetSystemHealthUseCase(
      mockBot as never,
      mockCacheService as never,
      mockRemnawaveService as never,
      mockDatabaseHealthService as never,
    );
  });

  it('reports status "ok" when resources are low and every component is reachable', async () => {
    const result = await useCase.execute();

    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
    expect(result.components.every((c) => c.status === 'ok')).toBe(true);
    expect(result.vps).toEqual(healthyVpsStats);
  });

  it('flags RAM over 90% as a warning', async () => {
    mockGetVpsStats.mockResolvedValue({ ...healthyVpsStats, memory: { usedBytes: 95, totalBytes: 100 } });

    const result = await useCase.execute();

    expect(result.status).toBe('warning');
    expect(result.warnings.some((w) => w.includes('RAM'))).toBe(true);
  });

  it('flags disk over 90% as a warning', async () => {
    mockGetVpsStats.mockResolvedValue({ ...healthyVpsStats, disk: { usedBytes: 91, totalBytes: 100 } });

    const result = await useCase.execute();

    expect(result.status).toBe('warning');
    expect(result.warnings.some((w) => w.includes('диск'))).toBe(true);
  });

  it('flags CPU over 95% as a warning', async () => {
    mockGetVpsStats.mockResolvedValue({ ...healthyVpsStats, cpuPercent: 96 });

    const result = await useCase.execute();

    expect(result.status).toBe('warning');
    expect(result.warnings.some((w) => w.includes('CPU'))).toBe(true);
  });

  it('does not flag resources exactly at the threshold (only strictly above)', async () => {
    mockGetVpsStats.mockResolvedValue({
      ...healthyVpsStats,
      memory: { usedBytes: 90, totalBytes: 100 },
      disk: { usedBytes: 90, totalBytes: 100 },
      cpuPercent: 95,
    });

    const result = await useCase.execute();

    expect(result.status).toBe('ok');
    expect(result.warnings).toEqual([]);
  });

  it('marks the database component critical and sets overall status critical when the DB is unreachable', async () => {
    mockDatabaseHealthService.ping.mockResolvedValue({ ok: false, latencyMs: 1000 });

    const result = await useCase.execute();

    const postgres = result.components.find((c) => c.name === 'postgres');
    expect(postgres?.status).toBe('critical');
    expect(result.status).toBe('critical');
    expect(result.warnings.some((w) => w.includes('PostgreSQL'))).toBe(true);
  });

  it('marks the Telegram Bot component critical when getMe() rejects', async () => {
    mockBot.telegram.getMe.mockRejectedValue(new Error('network down'));

    const result = await useCase.execute();

    const telegramBot = result.components.find((c) => c.name === 'telegram_bot');
    expect(telegramBot?.status).toBe('critical');
    expect(result.status).toBe('critical');
  });

  it('marks Redis critical when ping() resolves false or rejects', async () => {
    mockCacheService.ping.mockResolvedValue(false);

    const result = await useCase.execute();

    expect(result.components.find((c) => c.name === 'redis')?.status).toBe('critical');
    expect(result.status).toBe('critical');
  });

  it('marks Remnawave critical when getNodes() rejects', async () => {
    mockRemnawaveService.getNodes.mockRejectedValue(new Error('502'));

    const result = await useCase.execute();

    expect(result.components.find((c) => c.name === 'remnawave')?.status).toBe('critical');
    expect(result.status).toBe('critical');
  });

  it('critical status takes priority over resource warnings', async () => {
    mockGetVpsStats.mockResolvedValue({ ...healthyVpsStats, memory: { usedBytes: 95, totalBytes: 100 } });
    mockDatabaseHealthService.ping.mockResolvedValue({ ok: false, latencyMs: 1000 });

    const result = await useCase.execute();

    expect(result.status).toBe('critical');
  });

  it('maps recent errors from the logger buffer to ISO timestamps, newest first as provided', async () => {
    mockGetRecentErrors.mockReturnValue([
      { time: 1700000000000, message: 'boom' },
      { time: 1700000001000, message: 'kaboom' },
    ]);

    const result = await useCase.execute();

    expect(result.recentErrors).toEqual([
      { time: new Date(1700000000000).toISOString(), message: 'boom' },
      { time: new Date(1700000001000).toISOString(), message: 'kaboom' },
    ]);
  });
});
