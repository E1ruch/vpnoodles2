import { Context, Telegraf } from 'telegraf';
import type { RegisterUserUseCase } from '../../application/usecases/RegisterUserUseCase.js';
import type { ActivateTrialUseCase } from '../../application/usecases/ActivateTrialUseCase.js';
import type { GetSubscriptionUseCase } from '../../application/usecases/GetSubscriptionUseCase.js';
import type { PurchasePlanUseCase } from '../../application/usecases/PurchasePlanUseCase.js';
import type { RenewSubscriptionUseCase } from '../../application/usecases/RenewSubscriptionUseCase.js';
import type { GetUserDevicesUseCase } from '../../application/usecases/GetUserDevicesUseCase.js';
import type { DeleteUserDeviceUseCase } from '../../application/usecases/DeleteUserDeviceUseCase.js';
import type { SyncAllSubscriptionsFromRemnawaveUseCase } from '../../application/usecases/SyncAllSubscriptionsFromRemnawaveUseCase.js';
import type { MigrateUsersToRemnawaveUseCase } from '../../application/usecases/MigrateUsersToRemnawaveUseCase.js';
import type { DeactivateBlockedUserUseCase } from '../../application/usecases/DeactivateBlockedUserUseCase.js';
import type { RestoreBlockedUserUseCase } from '../../application/usecases/RestoreBlockedUserUseCase.js';
import type { GetAdminOverviewUseCase } from '../../application/usecases/GetAdminOverviewUseCase.js';
import type { IUserRepository } from '../../domain/interfaces/repositories.js';
import type { IPlanRepository } from '../../domain/interfaces/repositories.js';
import type { ISubscriptionRepository } from '../../domain/interfaces/repositories.js';
import type { IPaymentRepository } from '../../domain/interfaces/repositories.js';
import type { IAuditLogRepository } from '../../domain/interfaces/repositories.js';
import type { INotificationLogRepository } from '../../domain/interfaces/repositories.js';
import type { IReferralRewardRepository } from '../../domain/interfaces/repositories.js';
import type {
  IQRCodeService,
  IPaymentService,
  IRemnawaveService,
} from '../../domain/interfaces/services.js';
import type { ReferralSettingsService } from '../../application/usecases/referral/ReferralSettingsService.js';
import { getLogger } from '../../shared/logger/index.js';
import { formatDate } from '../../shared/utils/index.js';
import { getEnv } from '../../shared/config/env.js';
import { Texts } from './texts.js';
import {
  mainMenuKeyboard,
  planSelectionKeyboard,
  backToMainKeyboard,
  profileKeyboard,
  restoreAccessKeyboard,
} from './keyboards.js';
import { AdminHandlers } from './admin/AdminHandlers.js';
import { DeviceHandlers } from './user/DeviceHandlers.js';
import { PaymentHandlers } from './user/PaymentHandlers.js';
import { SubscriptionHandlers } from './user/SubscriptionHandlers.js';
import { ReferralHandlers } from './user/ReferralHandlers.js';

/**
 * Композиционный корень бота. Раньше все обработчики (меню, тарифы, оплата,
 * устройства) жили в этом одном классе — файл разросся до ~1150 строк. Разбит
 * на модули по доменным группам (тот же паттерн, что уже применялся к
 * AdminHandlers): DeviceHandlers, PaymentHandlers, SubscriptionHandlers.
 * Здесь остаётся только базовая навигация (start/back/profile/support/restore) и
 * регистрация всех групп обработчиков.
 */
export class BotHandlers {
  private bot: Telegraf;
  private registerUser: RegisterUserUseCase;
  private getSubscription: GetSubscriptionUseCase;
  private restoreBlockedUser: RestoreBlockedUserUseCase;
  private userRepo: IUserRepository;
  private referralSettings: ReferralSettingsService;
  private adminHandlers: AdminHandlers;
  private deviceHandlers: DeviceHandlers;
  private paymentHandlers: PaymentHandlers;
  private subscriptionHandlers: SubscriptionHandlers;
  private referralHandlers: ReferralHandlers;

  constructor(
    bot: Telegraf,
    registerUser: RegisterUserUseCase,
    activateTrial: ActivateTrialUseCase,
    getSubscription: GetSubscriptionUseCase,
    purchasePlan: PurchasePlanUseCase,
    renewSubscription: RenewSubscriptionUseCase,
    getUserDevices: GetUserDevicesUseCase,
    deleteUserDevice: DeleteUserDeviceUseCase,
    userRepo: IUserRepository,
    planRepo: IPlanRepository,
    subscriptionRepo: ISubscriptionRepository,
    paymentRepo: IPaymentRepository,
    auditLogRepo: IAuditLogRepository,
    qrCodeService: IQRCodeService,
    paymentService: IPaymentService,
    remnawaveService: IRemnawaveService,
    syncAllFromRemnawave: SyncAllSubscriptionsFromRemnawaveUseCase,
    migrateUsersToRemnawave: MigrateUsersToRemnawaveUseCase,
    notificationLogRepo: INotificationLogRepository,
    deactivateBlockedUser: DeactivateBlockedUserUseCase,
    restoreBlockedUser: RestoreBlockedUserUseCase,
    getAdminOverview: GetAdminOverviewUseCase,
    referralRewardRepo: IReferralRewardRepository,
    referralSettings: ReferralSettingsService,
  ) {
    this.bot = bot;
    this.registerUser = registerUser;
    this.getSubscription = getSubscription;
    this.restoreBlockedUser = restoreBlockedUser;
    this.userRepo = userRepo;
    this.referralSettings = referralSettings;

    this.deviceHandlers = new DeviceHandlers(userRepo, getUserDevices, deleteUserDevice);

    this.paymentHandlers = new PaymentHandlers(
      bot,
      userRepo,
      planRepo,
      paymentRepo,
      auditLogRepo,
      paymentService,
      purchasePlan,
      referralSettings,
    );

    this.subscriptionHandlers = new SubscriptionHandlers(
      userRepo,
      planRepo,
      subscriptionRepo,
      getSubscription,
      activateTrial,
      renewSubscription,
      qrCodeService,
      referralSettings,
    );

    this.referralHandlers = new ReferralHandlers(userRepo, referralRewardRepo, referralSettings);

    this.adminHandlers = new AdminHandlers(
      bot,
      userRepo,
      planRepo,
      subscriptionRepo,
      paymentRepo,
      auditLogRepo,
      remnawaveService,
      renewSubscription,
      syncAllFromRemnawave,
      migrateUsersToRemnawave,
      notificationLogRepo,
      deactivateBlockedUser,
      getAdminOverview,
    );
  }

  register(): void {
    this.bot.start(this.handleStart);
    this.bot.action('back_main', this.handleBackMain);
    this.bot.action('profile', this.handleProfile);
    this.bot.action('support', this.handleSupport);
    this.bot.action('restore_access', this.handleRestoreAccess);

    this.deviceHandlers.register(this.bot);
    this.paymentHandlers.register(this.bot);
    this.subscriptionHandlers.register(this.bot);
    this.referralHandlers.register(this.bot);
    this.adminHandlers.register(this.bot);

    // Global error handler
    this.bot.catch((err) => {
      const logger = getLogger();
      logger.error({ err }, 'Bot error');
    });
  }

  private handleStart = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      // ctx.startPayload существует только на суженном типе, который телеграф
      // передаёт в bot.start()-хендлеры (см. StartContextExtn в telegraf) — здесь
      // читаем его через безопасный runtime-доступ, не расширяя тип handleStart.
      const startPayload =
        'startPayload' in ctx ? ((ctx as unknown as { startPayload?: string }).startPayload ?? null) : null;

      const userId = await this.registerUser.execute(
        telegramUser.id,
        telegramUser.username ?? null,
        telegramUser.first_name ?? null,
        startPayload,
      );

      const user = await this.userRepo.findById(userId);

      const firstName = user?.firstName ?? telegramUser.first_name ?? 'Пользователь';

      // Пользователь ранее заблокировал бота (детект — 403 при отправке напоминания/
      // рассылки, см. DeactivateBlockedUserUseCase) и теперь снова его запустил —
      // значит бот больше не заблокирован. Не восстанавливаем доступ молча: ждём
      // явного подтверждения кнопкой, чтобы у пользователя не создавалось ощущение,
      // будто ничего не произошло.
      if (user?.isActive === false) {
        await ctx.reply(Texts.RESTORE_ACCESS_PROMPT.replace('{firstName}', firstName), {
          reply_markup: restoreAccessKeyboard(),
        });
        return;
      }

      const sub = await this.getSubscription.execute(userId);

      if (sub) {
        const welcomeText = Texts.WELCOME_BACK_NAME.replace('{firstName}', firstName);
        await ctx.reply(welcomeText, { reply_markup: mainMenuKeyboard(await this.isReferralProgramEnabled()) });
      } else {
        const welcomeText = Texts.WELCOME.replace('{firstName}', firstName);
        await ctx.reply(welcomeText, { reply_markup: planSelectionKeyboard() });
      }
    } catch (err) {
      logger.error({ err }, 'Error in /start handler');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  /**
   * §7.4 плана: пока ReferralSettings.enabled=false, точки входа в реферальную программу
   * (кнопка в главном меню/профиле/после выдачи подписки) должны молча скрываться, а не
   * вести на «функция отключена». Сбой чтения настроек трактуем как выключено — это
   * решение показывающее меньше, а не больше, если что-то пошло не так с Redis/БД.
   */
  private async isReferralProgramEnabled(): Promise<boolean> {
    try {
      return (await this.referralSettings.get()).enabled;
    } catch (err) {
      getLogger().error({ err }, 'Failed to read referral settings for menu visibility');
      return false;
    }
  }

  private handleRestoreAccess = async (ctx: Context): Promise<void> => {
    const logger = getLogger();
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      await this.restoreBlockedUser.execute(user.id);

      const firstName = user.firstName ?? telegramUser.first_name ?? 'Пользователь';
      await ctx.editMessageText(Texts.RESTORE_ACCESS_SUCCESS.replace('{firstName}', firstName), {
        reply_markup: mainMenuKeyboard(await this.isReferralProgramEnabled()),
      });
    } catch (err) {
      logger.error({ err }, 'Error restoring access');
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleBackMain = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const firstName = user.firstName ?? telegramUser.first_name ?? 'Пользователь';
      const welcomeText = Texts.WELCOME_BACK_NAME.replace('{firstName}', firstName);
      const referralEnabled = await this.isReferralProgramEnabled();

      await ctx.editMessageText(welcomeText, {
        reply_markup: mainMenuKeyboard(referralEnabled),
      });
    } catch {
      await ctx.reply(Texts.WELCOME_BACK, { reply_markup: mainMenuKeyboard(await this.isReferralProgramEnabled()) });
    }
  };

  private handleProfile = async (ctx: Context): Promise<void> => {
    try {
      const telegramUser = ctx.from;
      if (!telegramUser) return;

      const user = await this.userRepo.findByTelegramId(telegramUser.id);
      if (!user) return;

      const sub = await this.getSubscription.execute(user.id);
      const status = sub ? (sub.isExpired ? 'Не активно' : 'Активно') : 'Нет подписки';
      const devicesLine = sub
        ? Texts.PROFILE_DEVICES_LINE.replace('{usedDevices}', String(sub.usedDevices)).replace(
            '{deviceLimit}',
            String(sub.deviceLimit),
          )
        : '';

      const referralEnabled = await this.isReferralProgramEnabled();
      const referralLine = referralEnabled
        ? Texts.PROFILE_REFERRAL_LINE.replace('{invitedCount}', String(await this.userRepo.countReferredBy(user.id)))
        : '';

      const text = Texts.PROFILE.replace('{telegramId}', String(user.telegramId))
        .replace('{firstName}', user.firstName ?? 'Не указано')
        .replace('{status}', status)
        .replace('{regDate}', formatDate(user.createdAt))
        .replace('{devicesLine}', devicesLine)
        .replace('{referralLine}', referralLine);

      await ctx.editMessageText(text, {
        reply_markup: profileKeyboard(referralEnabled),
        parse_mode: 'Markdown',
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };

  private handleSupport = async (ctx: Context): Promise<void> => {
    const env = getEnv();
    try {
      await ctx.editMessageText(Texts.SUPPORT.replace('{supportUsername}', env.SUPPORT_USERNAME), {
        reply_markup: backToMainKeyboard(),
      });
    } catch {
      await ctx.reply(Texts.ERROR_GENERIC, { reply_markup: backToMainKeyboard() });
    }
  };
}
