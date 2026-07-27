import { Context, Telegraf } from 'telegraf';
import type { GetUserDevicesUseCase } from '../../../application/usecases/GetUserDevicesUseCase.js';
import type { DeleteUserDeviceUseCase } from '../../../application/usecases/DeleteUserDeviceUseCase.js';
import type { IUserRepository } from '../../../domain/interfaces/repositories.js';
import type { HwidDevice } from '../../../shared/types/index.js';
import { getLogger } from '../../../shared/logger/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import { formatDate } from '../../../shared/utils/index.js';
import { Texts } from '../texts.js';
import {
  backToMainKeyboard,
  profileKeyboard,
  devicesKeyboard,
  deleteDeviceConfirmKeyboard,
} from '../keyboards.js';

/**
 * Список устройств пользователя (HWID) и их удаление.
 * Вынесено из BotHandlers при разбиении handlers.ts (был 1147 строк) на модули
 * по доменным группам — код и тексты не менялись, только перенос.
 */
export class DeviceHandlers {
  constructor(
    private userRepo: IUserRepository,
    private getUserDevices: GetUserDevicesUseCase,
    private deleteUserDevice: DeleteUserDeviceUseCase,
  ) {}

  register(bot: Telegraf): void {
    bot.action('devices', this.handleDevices);
    bot.action(/^del_dev_(\d+)$/, this.handleDeleteDevicePrompt);
    bot.action(/^confirm_del_dev_(\d+)$/, this.handleDeleteDevice);
  }

  private handleDevices = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.editMessageText(Texts.DEVICES_NO_SUBSCRIPTION, {
          reply_markup: profileKeyboard(),
          parse_mode: 'Markdown',
        });
        return;
      }

      const { total, devices, deviceLimit } = devicesInfo;

      if (total === 0 || devices.length === 0) {
        const text = Texts.DEVICES_EMPTY.replace('{deviceLimit}', String(deviceLimit));
        await ctx.editMessageText(text, {
          reply_markup: devicesKeyboard(0, false),
          parse_mode: 'Markdown',
        });
        return;
      }

      const devicesList = devices.map((device, index) => this.formatDeviceListItem(device, index)).join('\n\n');
      const text = Texts.DEVICES_LIST.replace('{total}', String(total))
        .replace('{deviceLimit}', String(deviceLimit))
        .replace('{devicesList}', devicesList);

      await ctx.editMessageText(text, {
        reply_markup: devicesKeyboard(devices.length, true),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDeleteDevicePrompt = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      const match = cbData.data.match(/^del_dev_(\d+)$/);
      if (!match?.[1]) return;

      const deviceIndex = Number.parseInt(match[1], 10);
      if (!Number.isFinite(deviceIndex) || deviceIndex < 0) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.reply(Texts.DEVICES_NO_SUBSCRIPTION, { reply_markup: profileKeyboard() });
        return;
      }

      const device = devicesInfo.devices[deviceIndex];
      if (!device) {
        await ctx.reply(Texts.DEVICE_DELETE_NOT_FOUND, { reply_markup: devicesKeyboard(0, false) });
        return;
      }

      const text = Texts.DEVICE_DELETE_CONFIRM.replace(
        '{deviceInfo}',
        this.formatDeviceDetail(device, deviceIndex),
      );

      await ctx.editMessageText(text, {
        reply_markup: deleteDeviceConfirmKeyboard(deviceIndex),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDeleteDevice = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const cbData = ctx.callbackQuery;
      if (!cbData || !('data' in cbData) || !cbData.data) return;

      const match = cbData.data.match(/^confirm_del_dev_(\d+)$/);
      if (!match?.[1]) return;

      const deviceIndex = Number.parseInt(match[1], 10);
      if (!Number.isFinite(deviceIndex) || deviceIndex < 0) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.reply(Texts.DEVICES_NO_SUBSCRIPTION, { reply_markup: profileKeyboard() });
        return;
      }

      const device = devicesInfo.devices[deviceIndex];
      if (!device) {
        await ctx.editMessageText(Texts.DEVICE_DELETE_NOT_FOUND, {
          reply_markup: devicesKeyboard(0, false),
          parse_mode: 'Markdown',
        });
        return;
      }

      await this.deleteUserDevice.execute(user.id, device.hwid);

      const refreshed = await this.getUserDevices.execute(user.id);
      const total = refreshed?.total ?? 0;
      const deviceLimit = refreshed?.deviceLimit ?? devicesInfo.deviceLimit;

      if (total === 0 || !refreshed?.devices.length) {
        const text = Texts.DEVICE_DELETED.replace('{total}', '0').replace(
          '{deviceLimit}',
          String(deviceLimit),
        );
        await ctx.editMessageText(`${text}\n\n${Texts.DEVICES_EMPTY.replace('{deviceLimit}', String(deviceLimit))}`, {
          reply_markup: devicesKeyboard(0, false),
          parse_mode: 'Markdown',
        });
        return;
      }

      const devicesList = refreshed.devices
        .map((d, index) => this.formatDeviceListItem(d, index))
        .join('\n\n');
      const text =
        Texts.DEVICE_DELETED.replace('{total}', String(total)).replace(
          '{deviceLimit}',
          String(deviceLimit),
        ) +
        '\n\n' +
        Texts.DEVICES_LIST.replace('{total}', String(total))
          .replace('{deviceLimit}', String(deviceLimit))
          .replace('{devicesList}', devicesList);

      await ctx.editMessageText(text, {
        reply_markup: devicesKeyboard(refreshed.devices.length, true),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, 'Error deleting device');
      if (err instanceof NotFoundError) {
        await ctx.reply(Texts.DEVICE_DELETE_NOT_FOUND, { reply_markup: devicesKeyboard(0, false) });
        return;
      }
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private formatDeviceListItem(device: HwidDevice, index: number): string {
    const title = this.formatDeviceTitle(device, index);
    const details = this.formatDeviceMeta(device);
    return `${title}\n${details}`;
  }

  private formatDeviceDetail(device: HwidDevice, index: number): string {
    const title = this.formatDeviceTitle(device, index);
    const details = this.formatDeviceMeta(device);
    const hwid = this.formatHwidShort(device.hwid);
    return `${title}\n${details}\n🔑 ID: \`${hwid}\``;
  }

  private formatDeviceTitle(device: HwidDevice, index: number): string {
    const model = device.deviceModel?.trim();
    const platform = device.platform?.trim();
    if (model) return `**${index + 1}. ${model}**`;
    if (platform) return `**${index + 1}. ${platform}**`;
    return `**${index + 1}. Устройство**`;
  }

  private formatDeviceMeta(device: HwidDevice): string {
    const parts: string[] = [];
    if (device.platform) parts.push(`🖥 Платформа: ${device.platform}`);
    if (device.osVersion) parts.push(`📦 ОС: ${device.osVersion}`);
    if (device.createdAt) parts.push(`📅 Подключено: ${formatDate(new Date(device.createdAt))}`);
    if (parts.length === 0) parts.push('ℹ️ Дополнительные данные недоступны');
    return parts.join('\n');
  }

  private formatHwidShort(hwid: string): string {
    if (hwid.length <= 16) return hwid;
    return `${hwid.slice(0, 8)}…${hwid.slice(-4)}`;
  }
}
