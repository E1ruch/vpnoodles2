import { GetUserDevicesUseCase } from '../../src/application/usecases/GetUserDevicesUseCase';
import type { HwidDevice } from '../../src/shared/types/index';

const mockSubscriptionRepo = {
  findActiveByUserId: jest.fn(),
  findByUserId: jest.fn(),
};

const mockRemnawaveService = {
  getHwidDevices: jest.fn(),
};

function device(hwid: string, createdAt: string | null): HwidDevice {
  return {
    hwid,
    userUuid: 'rw-1',
    platform: 'android',
    osVersion: '13',
    deviceModel: hwid,
    userAgent: null,
    createdAt: createdAt as string,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('GetUserDevicesUseCase', () => {
  let useCase: GetUserDevicesUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    useCase = new GetUserDevicesUseCase(
      mockSubscriptionRepo as never,
      mockRemnawaveService as never,
    );
  });

  it('returns null when the user has no subscriptions at all', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);

    await expect(useCase.execute('u1')).resolves.toBeNull();
    expect(mockRemnawaveService.getHwidDevices).not.toHaveBeenCalled();
  });

  it('returns null when the latest subscription has no Remnawave user', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([
      { id: 's1', endDate: new Date('2026-01-01'), remnawaveUserId: null, deviceLimit: 3 },
    ]);

    await expect(useCase.execute('u1')).resolves.toBeNull();
  });

  it('orders devices by connection date so list positions are stable', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
      id: 's1',
      remnawaveUserId: 'rw-1',
      deviceLimit: 6,
    });
    mockRemnawaveService.getHwidDevices.mockResolvedValue({
      total: 3,
      devices: [
        device('c', '2026-03-03T00:00:00.000Z'),
        device('a', '2026-01-01T00:00:00.000Z'),
        device('b', '2026-02-02T00:00:00.000Z'),
      ],
    });

    const result = await useCase.execute('u1');

    expect(result?.devices.map((d) => d.hwid)).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({ subscriptionId: 's1', deviceLimit: 6, total: 3 });
  });

  it('pushes devices with missing or unparsable dates to the end, tie-breaking by hwid', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
      id: 's1',
      remnawaveUserId: 'rw-1',
      deviceLimit: 6,
    });
    mockRemnawaveService.getHwidDevices.mockResolvedValue({
      total: 4,
      devices: [
        device('z', 'garbage'),
        device('y', null),
        device('b', '2026-02-02T00:00:00.000Z'),
        device('a', '2026-01-01T00:00:00.000Z'),
      ],
    });

    const result = await useCase.execute('u1');

    expect(result?.devices.map((d) => d.hwid)).toEqual(['a', 'b', 'y', 'z']);
  });

  it('does not mutate the array returned by Remnawave', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
      id: 's1',
      remnawaveUserId: 'rw-1',
      deviceLimit: 6,
    });
    const devices = [
      device('b', '2026-02-02T00:00:00.000Z'),
      device('a', '2026-01-01T00:00:00.000Z'),
    ];
    mockRemnawaveService.getHwidDevices.mockResolvedValue({ total: 2, devices });

    await useCase.execute('u1');

    expect(devices.map((d) => d.hwid)).toEqual(['b', 'a']);
  });
});
