import { createHash } from 'node:crypto';
import { Context, Telegraf } from 'telegraf';
import type { GetUserDevicesUseCase } from '../../../application/usecases/GetUserDevicesUseCase.js';
import type { DeleteUserDeviceUseCase } from '../../../application/usecases/DeleteUserDeviceUseCase.js';
import type { IUserRepository } from '../../../domain/interfaces/repositories.js';
import type { HwidDevice } from '../../../shared/types/index.js';
import { getLogger } from '../../../shared/logger/index.js';
import { NotFoundError } from '../../../shared/errors/index.js';
import { escapeMarkdown, formatDateSafe, sanitizeMarkdownCode } from '../../../shared/utils/index.js';
import { Texts } from '../texts.js';
import { safeEditMessageText } from '../messageEdit.js';
import {
  backToMainKeyboard,
  profileKeyboard,
  devicesKeyboard,
  deleteDeviceConfirmKeyboard,
} from '../keyboards.js';

/** `del_dev_<индекс>` — старые сообщения в чатах, токен необязателен. */
const DELETE_PROMPT_PATTERN = /^del_dev_(\d+)(?:_([0-9a-f]{8}))?$/;
const DELETE_CONFIRM_PATTERN = /^confirm_del_dev_(\d+)(?:_([0-9a-f]{8}))?$/;

/**
 * Короткий стабильный идентификатор устройства для callback_data: сам hwid
 * бывает длиннее, чем влезает в лимит 64 байта, а индекса в списке
 * недостаточно (порядок может измениться между отрисовкой и нажатием).
 */
export function deviceToken(hwid: string): string {
  return createHash('sha256').update(hwid).digest('hex').slice(0, 8);
}

/**
 * Список устройств пользователя (HWID) и их удаление.
 *
 * Все подставляемые значения (модель/платформа/версия ОС) приходят из
 * Remnawave HWID, то есть их формируют клиентские приложения — это по сути
 * пользовательский ввод, и он обязан проходить через escapeMarkdown():
 * непарный `_` в модели вроде `SM_A515F` раньше ронял весь раздел в 400
 * "can't parse entities" → catch → ERROR_GENERIC, и пользователь не мог ни
 * увидеть список, ни удалить устройство.
 */
export class DeviceHandlers {
  constructor(
    private userRepo: IUserRepository,
    private getUserDevices: GetUserDevicesUseCase,
    private deleteUserDevice: DeleteUserDeviceUseCase,
  ) {}

  register(bot: Telegraf): void {
    bot.action('devices', this.handleDevices);
    bot.action(DELETE_PROMPT_PATTERN, this.handleDeleteDevicePrompt);
    bot.action(DELETE_CONFIRM_PATTERN, this.handleDeleteDevice);
  }

  private handleDevices = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await safeEditMessageText(ctx, Texts.DEVICES_NO_SUBSCRIPTION, {
          reply_markup: profileKeyboard(),
          parse_mode: 'Markdown',
        });
        return;
      }

      const { total, devices, deviceLimit } = devicesInfo;

      if (total !== devices.length) {
        logger.warn(
          { userId: user.id, total, listed: devices.length },
          'HWID total differs from the number of listed devices',
        );
      }

      if (total === 0 || devices.length === 0) {
        await safeEditMessageText(ctx, this.renderEmpty(deviceLimit), {
          reply_markup: devicesKeyboard(),
          parse_mode: 'Markdown',
        });
        return;
      }

      await safeEditMessageText(ctx, this.renderList(devices, total, deviceLimit), {
        reply_markup: devicesKeyboard(devices.map((d) => deviceToken(d.hwid))),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, 'Error rendering devices list');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDeleteDevicePrompt = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const target = this.parseCallbackTarget(ctx, DELETE_PROMPT_PATTERN);
      if (!target) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.reply(Texts.DEVICES_NO_SUBSCRIPTION, { reply_markup: profileKeyboard() });
        return;
      }

      const resolved = this.resolveDevice(devicesInfo.devices, target);
      if (!resolved) {
        await ctx.reply(Texts.DEVICE_DELETE_NOT_FOUND, { reply_markup: devicesKeyboard() });
        return;
      }

      const text = Texts.DEVICE_DELETE_CONFIRM.replace(
        '{deviceInfo}',
        () => this.formatDeviceDetail(resolved.device, resolved.index),
      );

      await safeEditMessageText(ctx, text, {
        reply_markup: deleteDeviceConfirmKeyboard(
          resolved.index,
          deviceToken(resolved.device.hwid),
        ),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, 'Error rendering device delete confirmation');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleDeleteDevice = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const target = this.parseCallbackTarget(ctx, DELETE_CONFIRM_PATTERN);
      if (!target) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const devicesInfo = await this.getUserDevices.execute(user.id);
      if (!devicesInfo) {
        await ctx.reply(Texts.DEVICES_NO_SUBSCRIPTION, { reply_markup: profileKeyboard() });
        return;
      }

      const resolved = this.resolveDevice(devicesInfo.devices, target);
      if (!resolved) {
        await safeEditMessageText(ctx, Texts.DEVICE_DELETE_NOT_FOUND, {
          reply_markup: devicesKeyboard(devicesInfo.devices.map((d) => deviceToken(d.hwid))),
          parse_mode: 'Markdown',
        });
        return;
      }

      await this.deleteUserDevice.execute(user.id, resolved.device.hwid);

      const refreshed = await this.getUserDevices.execute(user.id);
      const total = refreshed?.total ?? 0;
      const deviceLimit = refreshed?.deviceLimit ?? devicesInfo.deviceLimit;
      const devices = refreshed?.devices ?? [];

      if (total === 0 || devices.length === 0) {
        const text = `${this.renderDeleted(0, deviceLimit)}\n\n${this.renderEmpty(deviceLimit)}`;
        await safeEditMessageText(ctx, text, {
          reply_markup: devicesKeyboard(),
          parse_mode: 'Markdown',
        });
        return;
      }

      const text = `${this.renderDeleted(total, deviceLimit)}\n\n${this.renderList(
        devices,
        total,
        deviceLimit,
      )}`;

      await safeEditMessageText(ctx, text, {
        reply_markup: devicesKeyboard(devices.map((d) => deviceToken(d.hwid))),
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, 'Error deleting device');
      if (err instanceof NotFoundError) {
        await ctx.reply(Texts.DEVICE_DELETE_NOT_FOUND, { reply_markup: devicesKeyboard() });
        return;
      }
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private parseCallbackTarget(
    ctx: Context,
    pattern: RegExp,
  ): { index: number; token: string | null } | null {
    const cbData = ctx.callbackQuery;
    if (!cbData || !('data' in cbData) || !cbData.data) return null;

    const match = cbData.data.match(pattern);
    if (!match?.[1]) return null;

    const index = Number.parseInt(match[1], 10);
    if (!Number.isFinite(index) || index < 0) return null;

    return { index, token: match[2] ?? null };
  }

  /**
   * Токен из callback_data — источник истины, индекс — лишь подсказка: если
   * список переупорядочился или устройство уже удалено, лучше ответить «не
   * найдено», чем удалить соседнее устройство. Сообщения без токена (старые
   * клавиатуры) работают по индексу, как раньше.
   */
  private resolveDevice(
    devices: readonly HwidDevice[],
    target: { index: number; token: string | null },
  ): { device: HwidDevice; index: number } | null {
    const atIndex = devices[target.index];

    if (!target.token) {
      return atIndex ? { device: atIndex, index: target.index } : null;
    }

    if (atIndex && deviceToken(atIndex.hwid) === target.token) {
      return { device: atIndex, index: target.index };
    }

    const foundIndex = devices.findIndex((d) => deviceToken(d.hwid) === target.token);
    if (foundIndex === -1) return null;

    const device = devices[foundIndex];
    return device ? { device, index: foundIndex } : null;
  }

  private renderList(devices: readonly HwidDevice[], total: number, deviceLimit: number): string {
    const devicesList = devices
      .map((device, index) => this.formatDeviceListItem(device, index))
      .join('\n\n');

    return Texts.DEVICES_LIST.replace('{total}', String(total))
      .replace('{deviceLimit}', String(deviceLimit))
      .replace('{devicesList}', () => devicesList);
  }

  private renderEmpty(deviceLimit: number): string {
    return Texts.DEVICES_EMPTY.replace('{deviceLimit}', String(deviceLimit));
  }

  private renderDeleted(total: number, deviceLimit: number): string {
    return Texts.DEVICE_DELETED.replace('{total}', String(total)).replace(
      '{deviceLimit}',
      String(deviceLimit),
    );
  }

  private formatDeviceListItem(device: HwidDevice, index: number): string {
    const title = this.formatDeviceTitle(device, index);
    const details = this.formatDeviceMeta(device);
    return `${title}\n${details}`;
  }

  private formatDeviceDetail(device: HwidDevice, index: number): string {
    const title = this.formatDeviceTitle(device, index);
    const details = this.formatDeviceMeta(device);
    const hwid = sanitizeMarkdownCode(this.formatHwidShort(device.hwid));
    return `${title}\n${details}\n🔑 ID: \`${hwid}\``;
  }

  private formatDeviceTitle(device: HwidDevice, index: number): string {
    const model = device.deviceModel?.trim();
    const platform = device.platform?.trim();
    if (model) return `**${index + 1}. ${escapeMarkdown(model)}**`;
    if (platform) return `**${index + 1}. ${escapeMarkdown(platform)}**`;
    return `**${index + 1}. Устройство**`;
  }

  private formatDeviceMeta(device: HwidDevice): string {
    const parts: string[] = [];
    if (device.platform) parts.push(`🖥 Платформа: ${escapeMarkdown(device.platform)}`);
    if (device.osVersion) parts.push(`📦 ОС: ${escapeMarkdown(device.osVersion)}`);

    const createdAt = formatDateSafe(device.createdAt);
    if (createdAt) parts.push(`📅 Подключено: ${createdAt}`);

    if (parts.length === 0) parts.push('ℹ️ Дополнительные данные недоступны');
    return parts.join('\n');
  }

  private formatHwidShort(hwid: string): string {
    if (hwid.length <= 16) return hwid;
    return `${hwid.slice(0, 8)}…${hwid.slice(-4)}`;
  }
}
