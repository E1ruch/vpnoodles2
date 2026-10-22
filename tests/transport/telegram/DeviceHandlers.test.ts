import { DeviceHandlers, deviceToken } from '../../../src/transport/telegram/user/DeviceHandlers';
import type { HwidDevice } from '../../../src/shared/types/index';
import { Texts } from '../../../src/transport/telegram/texts';

type Handler = (ctx: unknown) => Promise<void>;

/** Мини-роутер вместо Telegraf: собирает bot.action() и дёргает по callback_data. */
class FakeBot {
  private handlers: Array<{ trigger: string | RegExp; handler: Handler }> = [];

  action(trigger: string | RegExp, handler: Handler): void {
    this.handlers.push({ trigger, handler });
  }

  async dispatch(data: string, ctx: unknown): Promise<void> {
    const entry = this.handlers.find((h) =>
      typeof h.trigger === 'string' ? h.trigger === data : h.trigger.test(data),
    );
    if (!entry) throw new Error(`No handler registered for callback data: ${data}`);
    await entry.handler(ctx);
  }
}

interface FakeCtx {
  from: { id: number };
  callbackQuery: { data: string };
  editMessageText: jest.Mock;
  reply: jest.Mock;
  answerCbQuery: jest.Mock;
}

function createCtx(data: string, editError?: unknown): FakeCtx {
  return {
    from: { id: 42 },
    callbackQuery: { data },
    editMessageText: jest.fn(async () => {
      if (editError) throw editError;
      return true;
    }),
    reply: jest.fn(async () => true),
    answerCbQuery: jest.fn(async () => true),
  };
}

function device(overrides: Partial<HwidDevice> & { hwid: string }): HwidDevice {
  return {
    userUuid: 'rw-1',
    platform: 'android',
    osVersion: '13',
    deviceModel: null,
    userAgent: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Приблизительная проверка того, на чём падал прод: Telegram отвечает 400
 * "can't parse entities", если в legacy-Markdown остался непарный спецсимвол.
 * Экранированные (`\_`) и содержимое code-entity из подсчёта убираем.
 */
function unbalancedMarkdownDelimiters(text: string): string[] {
  const stripped = text.replace(/\\./g, '').replace(/`[^`]*`/g, '');
  return ['_', '*', '`', '['].filter((ch) => (stripped.split(ch).length - 1) % 2 !== 0);
}

const mockUserRepo = { findByTelegramId: jest.fn() };
const mockGetUserDevices = { execute: jest.fn() };
const mockDeleteUserDevice = { execute: jest.fn() };

const SIX_DEVICES: HwidDevice[] = [
  device({ hwid: 'hwid-1', deviceModel: 'SM_A515F' }),
  device({ hwid: 'hwid-2', deviceModel: 'iPhone 14 Pro', platform: 'ios', osVersion: '18.1' }),
  device({ hwid: 'hwid-3', deviceModel: 'DESKTOP-PC_HOME', platform: 'windows' }),
  device({ hwid: 'hwid-4', deviceModel: 'Pixel*7' }),
  device({ hwid: 'hwid-5', deviceModel: '[Redmi] Note 12', osVersion: '14_beta' }),
  device({ hwid: 'hwid-6', deviceModel: 'nod`e', platform: 'linux_x86' }),
];

describe('DeviceHandlers', () => {
  let bot: FakeBot;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRepo.findByTelegramId.mockResolvedValue({ id: 'u1', telegramId: 42 });
    mockDeleteUserDevice.execute.mockResolvedValue(undefined);

    bot = new FakeBot();
    new DeviceHandlers(
      mockUserRepo as never,
      mockGetUserDevices as never,
      mockDeleteUserDevice as never,
    ).register(bot as never);
  });

  describe('devices list', () => {
    it('renders 6 of 6 devices with Markdown-breaking model names instead of failing', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 6,
        total: 6,
        devices: SIX_DEVICES,
      });
      const ctx = createCtx('devices');

      await bot.dispatch('devices', ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

      const [text, extra] = ctx.editMessageText.mock.calls[0] as [
        string,
        { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
      ];

      expect(unbalancedMarkdownDelimiters(text)).toEqual([]);
      expect(text).toContain('SM\\_A515F');
      expect(text).toContain('Pixel\\*7');
      expect(text).toContain('\\[Redmi] Note 12');
      expect(text).toContain('nod\\`e');
      expect(text).toContain('linux\\_x86');
      expect(text).toContain('14\\_beta');
      expect(text).toContain('Подключено: **6** из **6**');

      const deleteButtons = extra.reply_markup.inline_keyboard.filter((row) =>
        row[0]?.callback_data.startsWith('del_dev_'),
      );
      expect(deleteButtons).toHaveLength(6);
      expect(deleteButtons[0]?.[0]?.callback_data).toBe(`del_dev_0_${deviceToken('hwid-1')}`);
      deleteButtons.forEach((row) => {
        expect(Buffer.byteLength(row[0]?.callback_data ?? '', 'utf8')).toBeLessThanOrEqual(64);
      });
    });

    it('renders a device with an unparsable createdAt instead of throwing', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 3,
        total: 1,
        devices: [device({ hwid: 'hwid-1', deviceModel: 'iPhone', createdAt: 'garbage' })],
      });
      const ctx = createCtx('devices');

      await bot.dispatch('devices', ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
      const [text] = ctx.editMessageText.mock.calls[0] as [string];
      expect(text).toContain('iPhone');
      expect(text).not.toContain('Invalid Date');
      expect(text).not.toContain('📅 Подключено');
    });

    it('shows the empty state when there are no devices', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 3,
        total: 0,
        devices: [],
      });
      const ctx = createCtx('devices');

      await bot.dispatch('devices', ctx);

      const [text, extra] = ctx.editMessageText.mock.calls[0] as [
        string,
        { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
      ];
      expect(text).toContain('Подключено: **0** из **3**');
      expect(
        extra.reply_markup.inline_keyboard.some((row) =>
          row[0]?.callback_data.startsWith('del_dev_'),
        ),
      ).toBe(false);
    });

    it('offers the subscription screen when the user has no subscription', async () => {
      mockGetUserDevices.execute.mockResolvedValue(null);
      const ctx = createCtx('devices');

      await bot.dispatch('devices', ctx);

      expect(ctx.editMessageText).toHaveBeenCalledWith(
        Texts.DEVICES_NO_SUBSCRIPTION,
        expect.anything(),
      );
    });

    it('reports a generic error when Remnawave is unavailable', async () => {
      mockGetUserDevices.execute.mockRejectedValue(new Error('API error 500 on /api/hwid/devices'));
      const ctx = createCtx('devices');

      await bot.dispatch('devices', ctx);

      expect(ctx.reply).toHaveBeenCalledWith(Texts.ERROR_GENERIC, expect.anything());
    });

    it('does not report an error when Telegram answers "message is not modified"', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 6,
        total: 1,
        devices: [device({ hwid: 'hwid-1', deviceModel: 'iPhone' })],
      });
      const ctx = createCtx('devices', {
        description: 'Bad Request: message is not modified',
      });

      await bot.dispatch('devices', ctx);

      expect(ctx.reply).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalled();
    });
  });

  describe('delete confirmation prompt', () => {
    it('confirms the device the user picked and carries its token forward', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 6,
        total: 6,
        devices: SIX_DEVICES,
      });
      const data = `del_dev_2_${deviceToken('hwid-3')}`;
      const ctx = createCtx(data);

      await bot.dispatch(data, ctx);

      const [text, extra] = ctx.editMessageText.mock.calls[0] as [
        string,
        { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } },
      ];
      expect(text).toContain('DESKTOP-PC\\_HOME');
      expect(unbalancedMarkdownDelimiters(text)).toEqual([]);
      expect(extra.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe(
        `confirm_del_dev_2_${deviceToken('hwid-3')}`,
      );
    });

    it('says "not found" when the device from the callback is already gone', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 6,
        total: 1,
        devices: [device({ hwid: 'hwid-9' })],
      });
      const data = `del_dev_0_${deviceToken('hwid-1')}`;
      const ctx = createCtx(data);

      await bot.dispatch(data, ctx);

      expect(ctx.reply).toHaveBeenCalledWith(Texts.DEVICE_DELETE_NOT_FOUND, expect.anything());
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the device named by the token even when the list reordered', async () => {
      const reordered = [
        device({ hwid: 'hwid-3', deviceModel: 'C' }),
        device({ hwid: 'hwid-1', deviceModel: 'A' }),
        device({ hwid: 'hwid-2', deviceModel: 'B' }),
      ];
      mockGetUserDevices.execute
        .mockResolvedValueOnce({
          subscriptionId: 's1',
          deviceLimit: 6,
          total: 3,
          devices: reordered,
        })
        .mockResolvedValueOnce({
          subscriptionId: 's1',
          deviceLimit: 6,
          total: 2,
          devices: [reordered[0], reordered[2]],
        });

      // Пользователь нажал «удалить устройство 2», когда hwid-2 был вторым.
      const data = `confirm_del_dev_1_${deviceToken('hwid-2')}`;
      const ctx = createCtx(data);

      await bot.dispatch(data, ctx);

      expect(mockDeleteUserDevice.execute).toHaveBeenCalledWith('u1', 'hwid-2');
      expect(ctx.reply).not.toHaveBeenCalled();

      const [text] = ctx.editMessageText.mock.calls[0] as [string];
      expect(text).toContain('Устройство удалено');
      expect(text).toContain('Подключено: **2** из **6**');
    });

    it('falls back to the list position for old callbacks without a token', async () => {
      const devices = [
        device({ hwid: 'hwid-1', deviceModel: 'A' }),
        device({ hwid: 'hwid-2', deviceModel: 'B' }),
      ];
      mockGetUserDevices.execute
        .mockResolvedValueOnce({ subscriptionId: 's1', deviceLimit: 6, total: 2, devices })
        .mockResolvedValueOnce({
          subscriptionId: 's1',
          deviceLimit: 6,
          total: 1,
          devices: [devices[0]],
        });

      const ctx = createCtx('confirm_del_dev_1');

      await bot.dispatch('confirm_del_dev_1', ctx);

      expect(mockDeleteUserDevice.execute).toHaveBeenCalledWith('u1', 'hwid-2');
    });

    it('never deletes a different device when the token matches nothing', async () => {
      mockGetUserDevices.execute.mockResolvedValue({
        subscriptionId: 's1',
        deviceLimit: 6,
        total: 2,
        devices: [device({ hwid: 'hwid-1' }), device({ hwid: 'hwid-2' })],
      });
      const data = `confirm_del_dev_0_${deviceToken('hwid-gone')}`;
      const ctx = createCtx(data);

      await bot.dispatch(data, ctx);

      expect(mockDeleteUserDevice.execute).not.toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith(
        Texts.DEVICE_DELETE_NOT_FOUND,
        expect.anything(),
      );
    });

    it('shows the empty state after the last device is deleted', async () => {
      mockGetUserDevices.execute
        .mockResolvedValueOnce({
          subscriptionId: 's1',
          deviceLimit: 6,
          total: 1,
          devices: [device({ hwid: 'hwid-1' })],
        })
        .mockResolvedValueOnce({ subscriptionId: 's1', deviceLimit: 6, total: 0, devices: [] });

      const data = `confirm_del_dev_0_${deviceToken('hwid-1')}`;
      const ctx = createCtx(data);

      await bot.dispatch(data, ctx);

      const [text] = ctx.editMessageText.mock.calls[0] as [string];
      expect(text).toContain('Устройство удалено');
      expect(text).toContain('У вас пока нет зарегистрированных устройств');
    });
  });
});
