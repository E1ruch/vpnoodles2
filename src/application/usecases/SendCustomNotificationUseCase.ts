import type { Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type {
  IUserRepository,
  IAuditLogRepository,
  ISubscriptionRepository,
  IPlanRepository,
} from '../../domain/interfaces/repositories.js';
import type { ICacheService, IRemnawaveService } from '../../domain/interfaces/services.js';
import type { User } from '../../domain/entities/User.js';
import type { DeactivateBlockedUserUseCase } from './DeactivateBlockedUserUseCase.js';
import type { RenewSubscriptionUseCase } from './RenewSubscriptionUseCase.js';
import { getLogger } from '../../shared/logger/index.js';
import { sleep } from '../../shared/utils/index.js';
import { isTelegramBlockedError } from '../../infrastructure/notifications/telegramErrors.js';
import { ValidationError, NotFoundError, BroadcastLockedError } from '../../shared/errors/index.js';

const TELEGRAM_TEXT_MAX_LENGTH = 4096;
const BUTTON_LABEL_MAX_LENGTH = 64;
/** Пауза между отправками при рассылке «всем» — не нагружать Telegram API. Отдельная от BROADCAST_DELAY_MS в adminShared.ts (тот — Telegram-слой транспорта, use case не должен на него зависеть). */
const SEND_DELAY_MS = 50;
const BROADCAST_ALL_LOCK_KEY = 'admin:broadcast-all:lock';
const BROADCAST_ALL_LOCK_TTL_SECONDS = 600;
const MAX_EXTRA_DAYS = 3650;
const MAX_TRAFFIC_LIMIT_GB = 10000;
const BYTES_PER_GB = 1024 * 1024 * 1024;

export interface SendCustomNotificationButton {
  label: string;
  url: string;
}

export interface SendCustomNotificationReward {
  /** Продлить активную подписку на столько дней (переиспользует RenewSubscriptionUseCase). */
  extraDays?: number;
  /** Абсолютный новый лимит трафика в ГБ (не разница, целевое значение). */
  newTrafficLimitGb?: number;
}

export interface SendCustomNotificationInput {
  audience: 'user' | 'all';
  /** Обязателен при audience === 'user'. */
  userId?: string;
  text: string;
  button?: SendCustomNotificationButton | null;
  /** Только при audience === 'user' — выдать реальную награду вместе с сообщением. */
  reward?: SendCustomNotificationReward | null;
  /** Telegram id администратора, инициировавшего отправку — для записи в аудит-лог. */
  adminTelegramId: number;
}

export interface SendCustomNotificationResult {
  audience: 'user' | 'all';
  recipients: number;
  sent: number;
  failed: number;
  /** true только для audience === 'all' — цикл отправки продолжается в фоне. */
  queued: boolean;
  /** Что реально было выдано пользователю (audience === 'user' + reward), иначе null. */
  rewardApplied: Record<string, unknown> | null;
}

export interface SendCustomNotificationExecutionResult extends SendCustomNotificationResult {
  /**
   * Резолвится, когда фоновый цикл рассылки (audience === 'all') и запись в аудит-лог
   * завершены. Для audience === 'user' резолвится сразу — этот путь уже полностью
   * синхронен к моменту возврата execute(). Не часть HTTP-ответа — нужен только для
   * тестов и внутреннего ожидания завершения.
   */
  completion: Promise<void>;
}

/**
 * Отправка админом произвольного сообщения одному пользователю или всем активным —
 * веб-панельный аналог AdminBroadcastHandlers.runBroadcastAll из Telegram-бота.
 * Использует тот же паттерн (прямая отправка + агрегированная запись в audit_logs),
 * а не NotificationService/notification_logs — та таблица заточена под дедуп
 * плановых напоминаний (cycleKey), для одноразовой рассылки это лишняя семантика.
 */
export class SendCustomNotificationUseCase {
  constructor(
    private bot: Telegraf,
    private userRepo: IUserRepository,
    private auditLogRepo: IAuditLogRepository,
    private deactivateBlockedUser: DeactivateBlockedUserUseCase,
    private cacheService: ICacheService,
    private subscriptionRepo: ISubscriptionRepository,
    private renewSubscriptionUseCase: RenewSubscriptionUseCase,
    private remnawaveService: IRemnawaveService,
    private planRepo: IPlanRepository,
  ) {}

  async execute(input: SendCustomNotificationInput): Promise<SendCustomNotificationExecutionResult> {
    this.validate(input);
    const replyMarkup = buildReplyMarkup(input.button);

    if (input.audience === 'user') {
      return this.sendToUser(input, replyMarkup);
    }
    return this.sendToAll(input, replyMarkup);
  }

  /** Число получателей рассылки «всем» без запуска отправки — для превью в UI перед подтверждением. */
  async getAudienceCount(): Promise<number> {
    const users = await this.userRepo.findAll();
    return users.filter((u) => u.isActive !== false).length;
  }

  private validate(input: SendCustomNotificationInput): void {
    if (input.audience === 'user' && !input.userId) {
      throw new ValidationError('userId is required when audience is "user"');
    }

    const text = input.text?.trim() ?? '';
    if (!text) {
      throw new ValidationError('text must not be empty');
    }
    if (input.text.length > TELEGRAM_TEXT_MAX_LENGTH) {
      throw new ValidationError(`text must be at most ${TELEGRAM_TEXT_MAX_LENGTH} characters`);
    }

    if (input.button) {
      const label = input.button.label?.trim() ?? '';
      if (!label) {
        throw new ValidationError('button.label must not be empty');
      }
      if (label.length > BUTTON_LABEL_MAX_LENGTH) {
        throw new ValidationError(`button.label must be at most ${BUTTON_LABEL_MAX_LENGTH} characters`);
      }
      let url: URL;
      try {
        url = new URL(input.button.url);
      } catch {
        throw new ValidationError('button.url must be a valid URL');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ValidationError('button.url must use http or https');
      }
    }

    if (input.reward) {
      if (input.audience !== 'user') {
        throw new ValidationError('reward is only allowed when audience is "user"');
      }
      const { extraDays, newTrafficLimitGb } = input.reward;
      if (extraDays === undefined && newTrafficLimitGb === undefined) {
        throw new ValidationError('reward must set extraDays and/or newTrafficLimitGb');
      }
      if (extraDays !== undefined) {
        if (!Number.isInteger(extraDays) || extraDays <= 0 || extraDays > MAX_EXTRA_DAYS) {
          throw new ValidationError(`reward.extraDays must be an integer between 1 and ${MAX_EXTRA_DAYS}`);
        }
      }
      if (newTrafficLimitGb !== undefined) {
        if (
          typeof newTrafficLimitGb !== 'number' ||
          !Number.isFinite(newTrafficLimitGb) ||
          newTrafficLimitGb <= 0 ||
          newTrafficLimitGb > MAX_TRAFFIC_LIMIT_GB
        ) {
          throw new ValidationError(
            `reward.newTrafficLimitGb must be a number between 0 and ${MAX_TRAFFIC_LIMIT_GB}`,
          );
        }
      }
    }
  }

  private async applyReward(
    user: User,
    reward: SendCustomNotificationReward,
  ): Promise<Record<string, unknown>> {
    const applied: Record<string, unknown> = {};
    const activeSub = await this.subscriptionRepo.findActiveByUserId(user.id);

    if (reward.extraDays !== undefined) {
      if (!activeSub) {
        throw new NotFoundError('Active subscription', user.id);
      }
      const { endDate } = await this.renewSubscriptionUseCase.execute(activeSub.id, reward.extraDays);
      applied['extraDays'] = reward.extraDays;
      applied['newEndDate'] = endDate.toISOString();
    }

    if (reward.newTrafficLimitGb !== undefined) {
      if (!activeSub?.remnawaveUserId) {
        throw new NotFoundError('Remnawave user', user.id);
      }
      // Платные тарифы всегда безлимитны по дизайну (PurchasePlanUseCase ставит
      // trafficLimitBytes: 0 при апгрейде) — назначение конечного лимита превратило
      // бы безлимит в ограниченный трафик, что не входит в смысл этой награды.
      const plan = await this.planRepo.findById(activeSub.planId);
      if (plan?.type === 'paid') {
        throw new ValidationError(
          'Cannot set a traffic limit for a paid-plan user — their traffic is unlimited by design',
        );
      }
      await this.remnawaveService.updateTrafficLimit(
        activeSub.remnawaveUserId,
        Math.round(reward.newTrafficLimitGb * BYTES_PER_GB),
      );
      applied['newTrafficLimitGb'] = reward.newTrafficLimitGb;
    }

    return applied;
  }

  private async sendToUser(
    input: SendCustomNotificationInput,
    replyMarkup: InlineKeyboardMarkup | undefined,
  ): Promise<SendCustomNotificationExecutionResult> {
    const user = await this.userRepo.findById(input.userId as string);
    if (!user || user.isActive === false) {
      throw new NotFoundError('User', input.userId as string);
    }

    // Награда применяется до отправки сообщения и без частичного успеха: если
    // выдача упадёт, сообщение не уходит вовсе — иначе получится письмо про
    // бонус, которого пользователь не получил.
    let rewardApplied: Record<string, unknown> | null = null;
    if (input.reward) {
      rewardApplied = await this.applyReward(user, input.reward);
    }

    // Награда дублируется прямо в тексте письма — иначе получатель видит только
    // обычное сообщение и не поймёт, что ему заодно продлили подписку/лимит.
    const textToSend = input.text + buildRewardNotice(rewardApplied);

    let sent = 0;
    let failed = 0;
    try {
      await this.bot.telegram.sendMessage(user.telegramId, textToSend, { reply_markup: replyMarkup });
      sent = 1;
    } catch (err) {
      failed = 1;
      getLogger().warn({ err, telegramId: user.telegramId }, 'Custom notification send failed');
      if (isTelegramBlockedError(err)) {
        await this.deactivateBlockedUser.execute(user.id).catch((deactivateErr) => {
          getLogger().error({ err: deactivateErr, userId: user.id }, 'Failed to deactivate blocked user');
        });
      }
    }

    await this.writeAuditLog(input.adminTelegramId, 'admin_custom_notification_user', 'user', user.id, {
      text: textToSend,
      button: input.button ?? null,
      reward: rewardApplied,
      sent,
      failed,
    });

    return {
      audience: 'user',
      recipients: 1,
      sent,
      failed,
      queued: false,
      rewardApplied,
      completion: Promise.resolve(),
    };
  }

  private async sendToAll(
    input: SendCustomNotificationInput,
    replyMarkup: InlineKeyboardMarkup | undefined,
  ): Promise<SendCustomNotificationExecutionResult> {
    const lockAcquired = await this.cacheService.acquireLock(
      BROADCAST_ALL_LOCK_KEY,
      BROADCAST_ALL_LOCK_TTL_SECONDS,
    );
    if (!lockAcquired) {
      throw new BroadcastLockedError();
    }

    const allUsers = await this.userRepo.findAll();
    const recipients = allUsers.filter((u) => u.isActive !== false);

    const completion = this.runBroadcast(input, replyMarkup, recipients).finally(() =>
      this.cacheService.releaseLock(BROADCAST_ALL_LOCK_KEY),
    );

    return {
      audience: 'all',
      recipients: recipients.length,
      sent: 0,
      failed: 0,
      queued: true,
      rewardApplied: null,
      completion,
    };
  }

  private async runBroadcast(
    input: SendCustomNotificationInput,
    replyMarkup: InlineKeyboardMarkup | undefined,
    recipients: User[],
  ): Promise<void> {
    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      try {
        await this.bot.telegram.sendMessage(recipient.telegramId, input.text, { reply_markup: replyMarkup });
        sent++;
      } catch (err) {
        failed++;
        getLogger().warn({ err, telegramId: recipient.telegramId }, 'Custom broadcast send failed');
        if (isTelegramBlockedError(err)) {
          await this.deactivateBlockedUser.execute(recipient.id).catch((deactivateErr) => {
            getLogger().error(
              { err: deactivateErr, userId: recipient.id },
              'Failed to deactivate blocked user',
            );
          });
        }
      }
      await sleep(SEND_DELAY_MS);
    }

    await this.writeAuditLog(input.adminTelegramId, 'admin_custom_notification_all', 'broadcast', null, {
      recipients: recipients.length,
      sent,
      failed,
      text: input.text,
      button: input.button ?? null,
    });
  }

  private async writeAuditLog(
    adminTelegramId: number,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const adminUser = await this.userRepo.findByTelegramId(adminTelegramId);
    if (!adminUser) {
      getLogger().warn({ adminTelegramId }, 'Admin user not found for audit log');
      return;
    }

    await this.auditLogRepo.create({
      userId: adminUser.id,
      action,
      entityType,
      entityId,
      metadata,
    });
  }
}

function buildRewardNotice(reward: Record<string, unknown> | null): string {
  if (!reward) return '';
  const parts: string[] = [];
  if (typeof reward['extraDays'] === 'number') {
    parts.push(`продлили подписку на ${reward['extraDays']} дн.`);
  }
  if (typeof reward['newTrafficLimitGb'] === 'number') {
    parts.push(`увеличили лимит трафика до ${reward['newTrafficLimitGb']} ГБ`);
  }
  if (parts.length === 0) return '';
  return `\n\n🎁 Мы также ${parts.join(' и ')}!`;
}

function buildReplyMarkup(
  button: SendCustomNotificationButton | null | undefined,
): InlineKeyboardMarkup | undefined {
  if (!button) return undefined;
  return { inline_keyboard: [[{ text: button.label, url: button.url }]] };
}
