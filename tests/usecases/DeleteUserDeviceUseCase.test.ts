import { DeleteUserDeviceUseCase } from '../../src/application/usecases/DeleteUserDeviceUseCase';
import { NotFoundError, ValidationError } from '../../src/shared/errors/index';

const mockSubscriptionRepo = {
  findActiveByUserId: jest.fn(),
  findByUserId: jest.fn(),
};

const mockRemnawaveService = {
  getHwidDevices: jest.fn(),
  deleteHwidDevice: jest.fn(),
};

const mockSyncDevices = {
  execute: jest.fn(),
};

describe('DeleteUserDeviceUseCase', () => {
  let useCase: DeleteUserDeviceUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRemnawaveService.deleteHwidDevice.mockResolvedValue({ total: 0, devices: [] });
    mockSyncDevices.execute.mockResolvedValue(undefined);
    useCase = new DeleteUserDeviceUseCase(
      mockSubscriptionRepo as never,
      mockRemnawaveService as never,
      mockSyncDevices as never,
    );
  });

  it('rejects an empty hwid before touching Remnawave', async () => {
    await expect(useCase.execute('u1', '   ')).rejects.toThrow(ValidationError);
    expect(mockRemnawaveService.getHwidDevices).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when there is no subscription with a Remnawave user', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue(null);
    mockSubscriptionRepo.findByUserId.mockResolvedValue([]);

    await expect(useCase.execute('u1', 'hwid-1')).rejects.toThrow(NotFoundError);
    expect(mockRemnawaveService.deleteHwidDevice).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the hwid does not belong to the user', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
      id: 's1',
      remnawaveUserId: 'rw-1',
    });
    mockRemnawaveService.getHwidDevices.mockResolvedValue({
      total: 1,
      devices: [{ hwid: 'someone-else' }],
    });

    await expect(useCase.execute('u1', 'hwid-1')).rejects.toThrow(NotFoundError);
    expect(mockRemnawaveService.deleteHwidDevice).not.toHaveBeenCalled();
  });

  it('deletes the device and resyncs usedDevices', async () => {
    mockSubscriptionRepo.findActiveByUserId.mockResolvedValue({
      id: 's1',
      remnawaveUserId: 'rw-1',
    });
    mockRemnawaveService.getHwidDevices.mockResolvedValue({
      total: 2,
      devices: [{ hwid: 'hwid-1' }, { hwid: 'hwid-2' }],
    });

    await useCase.execute('u1', 'hwid-1');

    expect(mockRemnawaveService.deleteHwidDevice).toHaveBeenCalledWith('rw-1', 'hwid-1');
    expect(mockSyncDevices.execute).toHaveBeenCalledWith('s1');
  });
});
